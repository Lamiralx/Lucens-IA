/**
 * /api/lucens-experiments — Admin A/B testing du SYSTEM_PROMPT
 *
 * Modes :
 *   GET                         → liste les expériments actifs
 *   GET ?id=<experimentId>      → résultats d'un experiment (stats + décision)
 *   POST { config }             → créer ou updater un experiment
 *   POST ?id=<id>&action=evaluate → forcer l'évaluation décision
 *   DELETE ?id=<id>             → archiver/désactiver
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT.
 *
 * Config format (stockée en KV `lucens:experiments:config:<id>`) :
 * {
 *   "id": "prompt_uv_2026_05_d16_v2",
 *   "status": "active" | "paused" | "promoted_B" | "rolled_back",
 *   "traffic": { "A": 0.5, "B": 0.5 },
 *   "baselinePromptVersion": "lucens_prompt_2026_05_15_A",
 *   "candidatePromptVersion": "lucens_prompt_2026_05_15_B",
 *   "startedAt": 1778846400000,
 *   "minFeedbackPerArm": 150,
 *   "guardrails": {
 *     "maxNegativeRateDeltaPoints": 5,
 *     "maxMissedZonesDeltaPoints": 3,
 *     "maxFalsePositivesDeltaPoints": 5
 *   }
 * }
 */

import { applyCors, safeCompare } from './_lib/security.js';
import { evaluateExperiment } from './_lib/ab-testing.js';

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  const token = req.headers['x-lucens-admin'];
  const expected = process.env.LUCENS_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'LUCENS_ADMIN_TOKEN not configured on server' });
  }
  /* V39 fix F-03 — Comparaison timing-safe. */
  if (!safeCompare(typeof token === 'string' ? token : '', expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { kv } = await import('@vercel/kv');
    if (req.method === 'GET') return handleGet(req, res, kv);
    if (req.method === 'POST') return handlePost(req, res, kv);
    if (req.method === 'DELETE') return handleDelete(req, res, kv);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[EXPERIMENTS_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

async function handleGet(req, res, kv) {
  const wantedId = typeof req.query?.id === 'string' ? req.query.id : null;
  if (wantedId) return getExperimentDetail(wantedId, kv, res);

  const listRaw = await kv.lrange('lucens:experiments:list', 0, 49).catch(() => []);
  const experiments = parseList(listRaw);
  return res.status(200).json({ ok: true, total: experiments.length, experiments });
}

async function getExperimentDetail(id, kv, res) {
  if (!/^[a-z0-9_]+$/i.test(id)) return res.status(400).json({ error: 'Invalid experiment id format' });
  const configRaw = await kv.get(`lucens:experiments:config:${id}`);
  if (!configRaw) return res.status(404).json({ error: 'Experiment not found' });
  const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw;

  /* Fetch stats des 2 variantes */
  const variants = config.traffic ? Object.keys(config.traffic) : ['A', 'B'];
  const stats = {};
  for (const v of variants) {
    stats[v] = await kv.hgetall(`lucens:experiments:${id}:variant:${v}`).catch(() => ({})) || {};
    /* Normaliser tous en nombre */
    for (const [k, val] of Object.entries(stats[v])) stats[v][k] = Number(val || 0);
  }

  /* Évaluation */
  let evaluation = null;
  if (variants.length === 2) {
    evaluation = evaluateExperiment({ A: stats[variants[0]], B: stats[variants[1]], config });
  }

  return res.status(200).json({
    ok: true,
    id,
    config,
    stats,
    evaluation,
  });
}

async function handlePost(req, res, kv) {
  const action = typeof req.query?.action === 'string' ? req.query.action : null;
  const id = typeof req.query?.id === 'string' ? req.query.id : null;

  /* Mode action=evaluate : force l'évaluation et auto-archive si decision != continue */
  if (action === 'evaluate' && id) {
    const configRaw = await kv.get(`lucens:experiments:config:${id}`);
    if (!configRaw) return res.status(404).json({ error: 'Experiment not found' });
    const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw;
    const variants = config.traffic ? Object.keys(config.traffic) : ['A', 'B'];
    const stats = {};
    for (const v of variants) {
      stats[v] = await kv.hgetall(`lucens:experiments:${id}:variant:${v}`).catch(() => ({})) || {};
      for (const [k, val] of Object.entries(stats[v])) stats[v][k] = Number(val || 0);
    }
    const evaluation = evaluateExperiment({ A: stats[variants[0]], B: stats[variants[1]], config });
    /* Auto-update du status si décision claire */
    if (evaluation.decision === 'promote_B') {
      config.status = 'promoted_B';
      config.evaluatedAt = Date.now();
      await kv.set(`lucens:experiments:config:${id}`, JSON.stringify(config));
    } else if (evaluation.decision === 'rollback_B') {
      config.status = 'rolled_back';
      config.evaluatedAt = Date.now();
      await kv.set(`lucens:experiments:config:${id}`, JSON.stringify(config));
    }
    return res.status(200).json({ ok: true, id, evaluation, config });
  }

  /* Création / update d'un experiment */
  const body = req.body || {};
  const config = body.config || body;
  if (!config.id || !/^[a-z0-9_]+$/i.test(config.id)) {
    return res.status(400).json({ error: 'config.id required (alphanumeric + underscore only)' });
  }
  config.startedAt = config.startedAt || Date.now();
  config.status = config.status || 'active';
  config.traffic = config.traffic || { A: 0.5, B: 0.5 };
  config.minFeedbackPerArm = config.minFeedbackPerArm || 150;
  config.guardrails = config.guardrails || {
    maxNegativeRateDeltaPoints: 5,
    maxMissedZonesDeltaPoints: 3,
    maxFalsePositivesDeltaPoints: 5,
  };

  await kv.set(`lucens:experiments:config:${config.id}`, JSON.stringify(config));
  /* Ajout/refresh dans la liste */
  const existing = await kv.lrange('lucens:experiments:list', 0, 99).catch(() => []);
  const filtered = parseList(existing).filter(e => e.id !== config.id);
  filtered.unshift({ id: config.id, status: config.status, startedAt: config.startedAt });
  await kv.del('lucens:experiments:list').catch(() => {});
  for (let i = filtered.length - 1; i >= 0; i--) {
    await kv.lpush('lucens:experiments:list', JSON.stringify(filtered[i]));
  }
  await kv.ltrim('lucens:experiments:list', 0, 99);

  return res.status(200).json({ ok: true, config });
}

async function handleDelete(req, res, kv) {
  const id = typeof req.query?.id === 'string' ? req.query.id : null;
  if (!id || !/^[a-z0-9_]+$/i.test(id)) return res.status(400).json({ error: 'Invalid experiment id' });
  const configRaw = await kv.get(`lucens:experiments:config:${id}`);
  if (!configRaw) return res.status(404).json({ error: 'Experiment not found' });
  const config = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw;
  config.status = 'archived';
  config.archivedAt = Date.now();
  await kv.set(`lucens:experiments:config:${id}`, JSON.stringify(config));
  return res.status(200).json({ ok: true, archived: true, id });
}

function parseList(arr) {
  return (arr || []).map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

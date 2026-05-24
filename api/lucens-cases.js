/**
 * /api/lucens-cases — Récupération admin des cas annotés par les utilisateurs
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT (pas de ?token=).
 *
 * Modes :
 *   GET ?mode=list&cursor=0&limit=50  → liste compacte paginée (sans photo)
 *   GET ?mode=metadata&id=case_user_X → metadata seule du cas (sans photo, sans masque)
 *   GET ?mode=download&id=case_user_X → JSON complet (photo+masque) compatible annotate.html
 *   DELETE body { caseId }            → suppression admin d'un cas
 *
 * Tous les téléchargements et suppressions sont journalisés dans
 * `lucens:audit:admin_actions` pour conformité RGPD et traçabilité.
 *
 * Sécurité : CORS whitelist + token obligatoire + audit log + validation ID stricte.
 */

import { applyCors } from './_lib/security.js';

const MAX_LIMIT = 100;
const VALID_ID_REGEX = /^case_user_fb_[a-z0-9_]+$/i;

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  /* Vague 1 sécurité (ChatGPT P0) : ne plus accepter ?token= en query.
     Risque éliminé : fuite via logs Vercel, historique navigateur, Referer.
     Auth EXCLUSIVEMENT par header x-lucens-admin. */
  const token = req.headers['x-lucens-admin'];
  const expected = process.env.LUCENS_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'LUCENS_ADMIN_TOKEN not configured on server' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { kv } = await import('@vercel/kv');
    if (req.method === 'GET') return handleGet(req, res, kv);
    if (req.method === 'DELETE') return handleDelete(req, res, kv);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[CASES_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

async function handleGet(req, res, kv) {
  /* Rétrocompatibilité : si l'admin appelle l'ancien ?id=... sans mode,
     on assume download (comportement legacy). */
  const legacyId = typeof req.query?.id === 'string' && !req.query?.mode ? req.query.id : null;
  const mode = legacyId ? 'download' : String(req.query?.mode || 'list');
  const id = legacyId || (typeof req.query?.id === 'string' ? req.query.id : null);

  /* Mode liste paginée : sans photo, juste metadata pour browser admin */
  if (mode === 'list') {
    const cursor = Math.max(0, parseInt(String(req.query?.cursor || '0'), 10) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query?.limit || '50'), 10) || 50));
    const rawList = await kv.lrange('lucens:cases:list', cursor, cursor + limit - 1).catch(() => []);
    const cases = parseList(rawList).map(stripSensitiveListItem);
    return res.status(200).json({
      ok: true,
      mode: 'list',
      cursor,
      limit,
      nextCursor: cases.length === limit ? cursor + limit : null,
      totalReturned: cases.length,
      cases,
      hint: 'GET ?mode=metadata&id=<id> pour les metadata du cas, ou ?mode=download&id=<id> pour le JSON complet.',
    });
  }

  /* Mode metadata : metadata du cas SANS photo/masque (pour preview admin
     sans déclencher de téléchargement de données sensibles) */
  if (mode === 'metadata' && id) {
    if (!VALID_ID_REGEX.test(id)) return res.status(400).json({ error: 'Invalid case id format' });
    const raw = await kv.get(`lucens:cases:${id}`);
    if (!raw) return res.status(404).json({ error: 'Case not found' });
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    await logAdminAction(kv, { action: 'case_metadata_view', caseId: id });
    return res.status(200).json({
      ok: true,
      mode: 'metadata',
      case: stripCasePayload(doc),
    });
  }

  /* Mode download : JSON complet (photo + masque) pour annotate.html.
     Journalisé pour audit RGPD/sécurité. */
  if (mode === 'download' && id) {
    if (!VALID_ID_REGEX.test(id)) return res.status(400).json({ error: 'Invalid case id format' });
    const raw = await kv.get(`lucens:cases:${id}`);
    if (!raw) return res.status(404).json({ error: 'Case not found' });
    const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
    await logAdminAction(kv, { action: 'case_download', caseId: id });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.json"`);
    return res.status(200).send(JSON.stringify(doc, null, 2));
  }

  return res.status(400).json({ error: 'Invalid mode or missing id. Use ?mode=list|metadata|download' });
}

async function handleDelete(req, res, kv) {
  const body = req.body || {};
  const caseId = typeof body.caseId === 'string' ? body.caseId : null;
  if (!caseId) return res.status(400).json({ error: 'Missing caseId' });
  if (!VALID_ID_REGEX.test(caseId)) return res.status(400).json({ error: 'Invalid case id format' });

  await kv.del(`lucens:cases:${caseId}`).catch(() => {});
  await logAdminAction(kv, { action: 'case_delete_admin', caseId });

  return res.status(200).json({
    ok: true,
    deleted: true,
    caseId,
  });
}

function parseList(arr = []) {
  return arr.map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

function stripSensitiveListItem(item = {}) {
  /* On retire tout ce qui pourrait être sensible si l'item de liste
     contenait par erreur photo/masque (paranoia layer). */
  return {
    id: item.id || null,
    timestamp: item.timestamp || null,
    detection: item.detection || null,
    identification: item.identification || null,
    scoreFeedback: item.scoreFeedback || null,
    comment: item.comment || null,
    lang: item.lang || null,
  };
}

function stripCasePayload(doc = {}) {
  /* Mode metadata : on retourne tout SAUF photo + masque (les payloads lourds) */
  const clone = { ...doc };
  delete clone.photoJpeg;
  delete clone.maskPng;
  delete clone.correctivePhoto;
  delete clone.correctiveMask;
  return clone;
}

async function logAdminAction(kv, event) {
  /* Journalisation des actions admin pour traçabilité RGPD + sécurité.
     Conserve 1000 entrées max (rotation FIFO).
     N'inclut PAS le token admin (jamais loggé). */
  try {
    await kv.lpush('lucens:audit:admin_actions', JSON.stringify({
      ...event,
      timestamp: Date.now(),
    }));
    await kv.ltrim('lucens:audit:admin_actions', 0, 999);
  } catch { /* fail-silent : ne pas bloquer l'admin si KV indispo */ }
}

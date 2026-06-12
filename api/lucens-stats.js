/**
 * /api/lucens-stats — Dashboard admin learning-loop Lucens IA
 *
 * Vague 2 (audits ChatGPT + Gemini) : remplace l'ancien dashboard "compteurs
 * simples" par un dashboard d'apprentissage avec :
 *   - Stats par semaine (jusqu'à 8 dernières)
 *   - Drift current week vs baseline moyenne
 *   - Feedback quality + trust + learning weight pondérés
 *   - Métriques IoU/FPR/FNR/F1 agrégées (Gemini Livrable 1)
 *   - Taux consentement training
 *   - Review queue (cas haute valeur)
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT (pas de ?token=).
 *
 * Modes :
 *   GET                  → stats semaine courante (legacy compat)
 *   GET ?range=1w|4w|8w → multi-semaines + drift
 *   GET ?range=8w&variant=A|B → filtre par variante A/B (pour V3 a/b test)
 *
 * Référence : NIST AI Risk Management Framework — fonctions
 * gouvernance/cartographie/MESURE/gestion. La mesure robuste manquait.
 */

import { applyCors } from './_lib/security.js';
import { isoWeekKey } from './_lib/isoweek.js';
import { timingSafeEqual } from 'node:crypto';

const MAX_RANGE_WEEKS = 8;

/* Comparaison constant-time pour le token admin.
   Empêche les attaques de timing qui pourraient extraire le token
   caractère par caractère en mesurant la durée de comparaison. */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  /* timingSafeEqual exige des longueurs identiques : si différentes,
     on compare deux buffers identiques pour préserver le temps constant
     puis on renvoie false. */
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* Vague 1 sécurité : ne plus accepter ?token= en query. */
  const token = req.headers['x-lucens-admin'];
  const expected = process.env.LUCENS_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'LUCENS_ADMIN_TOKEN not configured on server' });
  }
  if (!safeCompare(typeof token === 'string' ? token : '', expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { kv } = await import('@vercel/kv');

    /* V296 — Rapport d'usage/coût réel par analyse : ?view=usage[&days=N] */
    if (String(req.query?.view || '') === 'usage') {
      return await respondUsage(req, res, kv);
    }

    const rangeParam = String(req.query?.range || '1w');
    const weeks = Math.min(MAX_RANGE_WEEKS, Math.max(1, parseInt(rangeParam, 10) || 1));
    const variant = typeof req.query?.variant === 'string' ? req.query.variant.slice(0, 32) : null;

    /* Calcul des N dernières clés ISO week */
    const weekKeys = getLastIsoWeeks(weeks);

    /* Fetch en parallèle de toutes les clés par semaine */
    const weekly = [];
    for (const wk of weekKeys) {
      const [
        detection,
        identification,
        score,
        total,
        quality,
        trust,
        learning,
        consent,
        iou,
      ] = await Promise.all([
        kv.hgetall(`lucens:stats:${wk}:detection`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:identification`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:score`).catch(() => ({})),
        kv.get(`lucens:stats:${wk}:total`).catch(() => 0),
        kv.hgetall(`lucens:stats:${wk}:quality`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:trust`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:learning`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:consent`).catch(() => ({})),
        kv.hgetall(`lucens:stats:${wk}:iou`).catch(() => ({})),
      ]);

      const totalN = Number(total || 0);
      weekly.push({
        week: wk,
        total: totalN,
        detection: detection || {},
        identification: identification || {},
        score: score || {},
        kpis: computeWeeklyKpis({
          total: totalN,
          /* Fix null guard — kv.hgetall() retourne null (pas {}) quand la clé
             Redis n'existe pas. Le destructure avec default `detection = {}`
             ne s'applique QUE si undefined, pas null. Sans cette coercion,
             computeWeeklyKpis crash sur `detection.missed_zones`. */
          detection: detection || {},
          identification: identification || {},
          score: score || {},
          quality: quality || {},
          trust: trust || {},
          learning: learning || {},
          consent: consent || {},
          iou: iou || {},
        }),
      });
    }

    /* Listes récentes (compat avec ancien dashboard) */
    const [recentRaw, negativeRaw, reviewQueueRaw] = await Promise.all([
      kv.lrange('lucens:feedback:recent', 0, 99).catch(() => []),
      kv.lrange('lucens:feedback:negative', 0, 49).catch(() => []),
      kv.lrange('lucens:cases:review_queue', 0, 49).catch(() => []),
    ]);

    /* Audit logs admin (compat RGPD) */
    const adminAuditRaw = await kv.lrange('lucens:audit:admin_actions', 0, 49).catch(() => []);

    res.status(200).json({
      ok: true,
      generatedAt: Date.now(),
      rangeWeeks: weeks,
      variant,
      weekly,
      aggregate: computeAggregate(weekly),
      drift: computeDrift(weekly),
      recentFeedback: parseList(recentRaw),
      negativeFeedback: parseList(negativeRaw),
      reviewQueue: parseList(reviewQueueRaw),
      adminAudit: parseList(adminAuditRaw),
      /* Legacy compat : ancien shape pour anciens consumers */
      week: weekKeys[weekKeys.length - 1],
      total: weekly[weekly.length - 1]?.total || 0,
      stats: {
        detection: weekly[weekly.length - 1]?.detection || {},
        identification: weekly[weekly.length - 1]?.identification || {},
        score: weekly[weekly.length - 1]?.score || {},
      },
    });
  } catch (err) {
    /* Log côté serveur uniquement — le détail technique ne doit pas
       remonter au client (info disclosure). */
    console.error('[STATS_ERROR]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */

function parseList(arr = []) {
  return arr.map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

/* V296 — Rapport d'usage : coût RÉEL par analyse, agrégé par jour + 100 derniers
   appels. Source : clés écrites par api/analyze.js (lucens:usage:daily:* + log). */
async function respondUsage(req, res, kv) {
  const days = Math.min(90, Math.max(1, parseInt(req.query?.days, 10) || 14));
  const dayKeys = getLastDays(days);
  const [dailies, logRaw] = await Promise.all([
    Promise.all(dayKeys.map(d => kv.hgetall(`lucens:usage:daily:${d}`).catch(() => ({})))),
    kv.lrange('lucens:usage:log', 0, 99).catch(() => []),
  ]);
  const daily = dayKeys.map((d, i) => {
    const h = dailies[i] || {};
    const count = Number(h.count || 0);
    const costUsd = +(Number(h.cost_micro_usd || 0) / 1e6).toFixed(4);
    return {
      day: d,
      count,
      costUsd,
      avgCostUsd: count ? +(costUsd / count).toFixed(4) : 0,
      inTok: Number(h.in_tok || 0),
      outTok: Number(h.out_tok || 0),
      cacheReadTok: Number(h.cache_read_tok || 0),
      cacheCreateTok: Number(h.cache_create_tok || 0),
      primary: Number(h.primary_count || 0),
      fallback: Number(h.fallback_count || 0),
    };
  });
  const totalCount = daily.reduce((a, d) => a + d.count, 0);
  const totalCost = +daily.reduce((a, d) => a + d.costUsd, 0).toFixed(4);
  const totalFallback = daily.reduce((a, d) => a + d.fallback, 0);
  const totalOut = daily.reduce((a, d) => a + d.outTok, 0);
  return res.status(200).json({
    ok: true,
    view: 'usage',
    generatedAt: Date.now(),
    days,
    summary: {
      totalAnalyses: totalCount,
      totalCostUsd: totalCost,
      avgCostPerAnalysisUsd: totalCount ? +(totalCost / totalCount).toFixed(4) : 0,
      avgOutputTokens: totalCount ? Math.round(totalOut / totalCount) : 0,
      fallbackRatePct: totalCount ? +((totalFallback / totalCount) * 100).toFixed(1) : 0,
    },
    daily,
    recent: parseList(logRaw),
  });
}

function getLastDays(count) {
  const out = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function computeWeeklyKpis({ total, detection = {}, identification = {}, score = {}, quality = {}, trust = {}, learning = {}, consent = {}, iou = {} }) {
  const n = Math.max(1, Number(total || 0));
  const missed = Number(detection.missed_zones || 0);
  const fp = Number(detection.false_positives || 0);
  const idBad = Number(identification.incorrect || 0);
  const idPartial = Number(identification.partial || 0);
  const scoreWrong = Number(score.wrong || 0);
  const scoreOff = Number(score.off || 0);
  const negative = missed + fp + idBad + idPartial + scoreWrong + scoreOff;

  /* Quality : moyenne sur N entrées */
  const qCount = Number(quality.count || 0);
  const qSum = Number(quality.sum || 0);
  const qHigh = Number(quality.high || 0);
  const qLow = Number(quality.low || 0);
  const qAvg = qCount > 0 ? Math.round(qSum / qCount) : 0;

  /* Trust : sum_x100 / count → [0..1] */
  const tCount = Number(trust.count || 0);
  const tSum = Number(trust.sum_x100 || 0);
  const tLow = Number(trust.low_trust || 0);
  const tAvg = tCount > 0 ? +(tSum / tCount / 100).toFixed(3) : 0;

  /* Learning weight effectif moyen */
  const lCount = Number(learning.count || 0);
  const lSum = Number(learning.sum_x100 || 0);
  const lAvg = lCount > 0 ? +(lSum / lCount / 100).toFixed(3) : 0;

  /* IoU / F1 / FPR / FNR moyens (semaine) */
  const iouCount = Number(iou.count || 0);
  const iouAvg = iouCount > 0 ? +(Number(iou.sum_x10000 || 0) / iouCount / 10000).toFixed(4) : null;
  const f1Avg = iouCount > 0 ? +(Number(iou.f1_sum_x10000 || 0) / iouCount / 10000).toFixed(4) : null;
  const fprAvg = iouCount > 0 ? +(Number(iou.fpr_sum_x10000 || 0) / iouCount / 10000).toFixed(4) : null;
  const fnrAvg = iouCount > 0 ? +(Number(iou.fnr_sum_x10000 || 0) / iouCount / 10000).toFixed(4) : null;

  /* Consent / cases */
  const consTrue = Number(consent.training_true || 0);
  const consFalse = Number(consent.training_false || 0);
  const consDenom = consTrue + consFalse || 1;

  return {
    negativeRate: pct(negative / n),
    missedZonesRate: pct(missed / n),
    falsePositiveRate: pct(fp / n),
    identificationIssueRate: pct((idBad + idPartial) / n),
    scoreIssueRate: pct((scoreWrong + scoreOff) / n),
    avgFeedbackQuality: qAvg,
    highQualityFeedback: qHigh,
    lowQualityFeedback: qLow,
    avgTrustScore: tAvg,
    lowTrustFeedback: tLow,
    avgLearningWeight: lAvg,
    consentTrainingRate: pct(consTrue / consDenom),
    casesWithMask: iouCount,
    avgIoU: iouAvg,
    avgF1: f1Avg,
    avgFPR: fprAvg,
    avgFNR: fnrAvg,
  };
}

function computeAggregate(weekly) {
  const total = weekly.reduce((a, w) => a + Number(w.total || 0), 0);
  const negativeWeighted = weekly.reduce((a, w) => a + (w.kpis.negativeRate / 100) * Number(w.total || 0), 0);
  /* Learning value totale = somme des learningWeight × count par semaine */
  const learningValue = weekly.reduce((a, w) => a + w.kpis.avgLearningWeight * Number(w.total || 0), 0);
  return {
    totalFeedback: total,
    weightedNegativeRate: pct(negativeWeighted / Math.max(1, total)),
    cumulativeLearningValue: +learningValue.toFixed(2),
    weeksCovered: weekly.length,
  };
}

function computeDrift(weekly) {
  if (weekly.length < 2) return { available: false };
  const current = weekly[weekly.length - 1];
  const baseline = weekly.slice(0, -1);
  const avgBaselineNegative = avg(baseline.map(w => w.kpis.negativeRate));
  const currentNegative = current.kpis.negativeRate;
  /* IoU drift : moyenne baseline vs current si dispo */
  const baselineIoUs = baseline.map(w => w.kpis.avgIoU).filter(v => typeof v === 'number');
  const avgBaselineIoU = baselineIoUs.length ? avg(baselineIoUs) : null;
  const currentIoU = current.kpis.avgIoU;
  const iouDeltaPoints = (typeof currentIoU === 'number' && typeof avgBaselineIoU === 'number')
    ? +((currentIoU - avgBaselineIoU) * 100).toFixed(2)
    : null;
  return {
    available: true,
    currentWeek: current.week,
    baselineWeeks: baseline.map(w => w.week),
    negativeRateCurrent: currentNegative,
    negativeRateBaseline: round(avgBaselineNegative),
    negativeRateDeltaPoints: round(currentNegative - avgBaselineNegative),
    alertNegative: currentNegative - avgBaselineNegative >= 10,
    iouCurrent: currentIoU,
    iouBaseline: avgBaselineIoU,
    iouDeltaPoints,
    alertIoU: typeof iouDeltaPoints === 'number' && iouDeltaPoints <= -5,
  };
}

function getLastIsoWeeks(count) {
  const weeks = [];
  const d = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - i * 7);
    weeks.push(getIsoWeekKey(x));
  }
  return weeks;
}

function getIsoWeekKey(date) {
  /* V39 fix F-14 — Délégué au module partagé `_lib/isoweek.js` (algo ISO 8601
     correct, basé sur le jeudi de la semaine). Garantit cohérence d'écriture
     (feedback.js) et de lecture (ici) des clés `lucens:stats:YYYY-Www:*`. */
  return isoWeekKey(date);
}

function avg(arr) {
  const clean = arr.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function pct(x) {
  return round((Number(x || 0)) * 100);
}

function round(x) {
  return Number(Number(x || 0).toFixed(2));
}

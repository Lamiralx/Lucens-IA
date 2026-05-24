/**
 * /api/lucens-prioritize — Active learning prioritization (Vague 3 P2)
 *
 * Gemini Livrable 2 : Core-Set Selection inspiré Sener & Savarese 2018.
 * Combine 3 signaux pour ne pas perdre de temps à annoter manuellement
 * des cas redondants ou peu informatifs :
 *   - Uncertainty : 1 − |confidence − 0.5| × 2 (priorité aux cas où le
 *     modèle hésitait)
 *   - Surprise : 1 − IoU (priorité aux cas où l'expert a totalement
 *     désavoué)
 *   - Diversity : K-Means clustering sur features [riskScore, coverage,
 *     learningWeight, fpr, fnr] pour éviter d'annoter 10× le même type
 *     d'erreur. Représentant de chaque cluster = top score combiné.
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT.
 *
 * GET ?k=20 → retourne les top K cas à annoter en priorité
 *
 * Référence : Sener & Savarese, "Active Learning for Convolutional
 * Neural Networks: A Core-Set Approach", ICLR 2018.
 */

import { applyCors } from './_lib/security.js';

const DEFAULT_K = 20;
const MAX_K = 50;
const MAX_CASES_SCAN = 200;     /* limite KV reads pour rester rapide */
const N_CLUSTERS = 8;           /* nombre de clusters K-Means */
const W_UNCERTAINTY = 0.40;     /* poids signal uncertainty */
const W_SURPRISE = 0.60;        /* poids signal surprise (mismatch IA vs user) */

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-lucens-admin'];
  const expected = process.env.LUCENS_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'LUCENS_ADMIN_TOKEN not configured on server' });
  }
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const k = Math.min(MAX_K, Math.max(1, parseInt(String(req.query?.k || DEFAULT_K), 10) || DEFAULT_K));

  try {
    const { kv } = await import('@vercel/kv');

    /* Étape 1 : lister les cases candidats */
    const list = await kv.lrange('lucens:cases:list', 0, MAX_CASES_SCAN - 1).catch(() => []);
    const candidates = parseList(list);
    if (!candidates.length) {
      return res.status(200).json({ ok: true, total: 0, cases: [], message: 'No cases available yet.' });
    }

    /* Étape 2 : fetch détails complets (en parallèle, batch de 20 pour
       limiter la pression sur KV) */
    const enriched = [];
    const BATCH = 20;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const docs = await Promise.all(slice.map(c =>
        kv.get(`lucens:cases:${c.id}`).then(raw => {
          try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
        }).catch(() => null)
      ));
      for (let j = 0; j < slice.length; j++) {
        const meta = slice[j];
        const doc = docs[j];
        if (!doc) continue;
        /* Filtre : on ignore les cas avec trust très bas (vandalisme) */
        if (typeof doc.trustScore === 'number' && doc.trustScore < 0.3) continue;
        enriched.push(buildCandidateFeatures(meta, doc));
      }
    }

    if (!enriched.length) {
      return res.status(200).json({ ok: true, total: 0, cases: [], message: 'No exploitable cases (all filtered by trust score).' });
    }

    /* Étape 3 : calcul des scores uncertainty + surprise */
    for (const c of enriched) {
      c.uncertaintyScore = computeUncertainty(c);
      c.surpriseScore = computeSurprise(c);
      c.combinedScore = +(W_UNCERTAINTY * c.uncertaintyScore + W_SURPRISE * c.surpriseScore).toFixed(4);
    }

    /* Étape 4 : K-Means clustering pour la diversité */
    const features = enriched.map(c => c.features);
    const clusterCount = Math.min(N_CLUSTERS, enriched.length);
    const clusters = kmeansSimple(features, clusterCount);

    /* Étape 5 : pour chaque cluster, sélectionner le meilleur représentant
       (plus haut combinedScore), puis trier par score global décroissant */
    const byCluster = new Map();
    for (let i = 0; i < enriched.length; i++) {
      const cl = clusters.assignments[i];
      if (!byCluster.has(cl)) byCluster.set(cl, []);
      byCluster.get(cl).push(enriched[i]);
    }
    const representatives = [];
    for (const [clusterId, members] of byCluster) {
      members.sort((a, b) => b.combinedScore - a.combinedScore);
      /* On prend les top membres de chaque cluster proportionnellement
         à la taille du cluster, jusqu'à K total */
      const takeN = Math.max(1, Math.floor(k * members.length / enriched.length));
      for (let i = 0; i < takeN && i < members.length; i++) {
        representatives.push({ ...members[i], clusterId });
      }
    }
    representatives.sort((a, b) => b.combinedScore - a.combinedScore);
    const top = representatives.slice(0, k);

    return res.status(200).json({
      ok: true,
      total: enriched.length,
      returned: top.length,
      k,
      cases: top.map(serializeCandidate),
      methodology: {
        algorithm: 'Core-Set hybrid (Sener & Savarese 2018) + K-Means clustering',
        weights: { uncertainty: W_UNCERTAINTY, surprise: W_SURPRISE },
        clusters: clusterCount,
        filteredByTrust: candidates.length - enriched.length,
      },
    });
  } catch (err) {
    console.error('[PRIORITIZE_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

/* ─── Algorithmes ──────────────────────────────────────────── */

/**
 * buildCandidateFeatures : extrait le vecteur de features normalisé pour
 * le clustering. 5 dimensions : [riskScore, coverage, learningWeight, fpr, fnr]. */
function buildCandidateFeatures(meta, doc) {
  const m = doc.maskMetrics || {};
  const ctx = doc.feedbackContext?.originalAnalysis || {};
  const riskScore = Number(ctx.riskScore || 0) / 100;        /* 0-1 */
  const coverage = Number(doc.coveragePercent || 0) / 100;   /* 0-1 (approx) */
  const learningWeight = Number(doc.learningWeight || 0);    /* déjà 0-1 */
  const fpr = Number(m.falsePositiveRatio || 0);             /* 0-1 */
  const fnr = Number(m.falseNegativeRatio || 0);             /* 0-1 */
  return {
    id: doc.id || meta.id,
    timestamp: doc.timestamp || meta.timestamp,
    aiConfidence: extractAiConfidence(doc),
    iou: typeof m.iou === 'number' ? m.iou : null,
    fpr,
    fnr,
    f1: typeof m.f1 === 'number' ? m.f1 : null,
    learningWeight,
    trustScore: Number(doc.trustScore || 0),
    feedbackQualityScore: Number(doc.feedbackQualityScore || 0),
    coveragePercent: Number(doc.coveragePercent || 0),
    establishmentType: ctx.establishmentType || null,
    moment: ctx.moment || null,
    detection: doc.feedbackContext?.detection || null,
    identification: doc.feedbackContext?.identification || null,
    scoreFeedback: doc.feedbackContext?.scoreFeedback || null,
    comment: doc.feedbackContext?.comment || null,
    features: [riskScore, coverage, learningWeight, fpr, fnr],
  };
}

/**
 * extractAiConfidence : récupère la confidence moyenne IA depuis le contexte
 * original. Si non dispo, fallback à 0.5 (incertitude maximale). */
function extractAiConfidence(doc) {
  const ctx = doc.feedbackContext?.originalAnalysis;
  if (!ctx) return 0.5;
  /* Heuristique : si on a riskScore moyen, on l'utilise comme proxy.
     Sinon 0.5 par défaut. */
  if (typeof ctx.riskScore === 'number') {
    /* Risk score moyen → confidence moyenne (approximation) */
    return Math.max(0.3, Math.min(0.95, 0.5 + (ctx.riskScore - 50) / 200));
  }
  return 0.5;
}

/**
 * computeUncertainty : 1 − |c − 0.5| × 2 → max à c=0.5, min à c=0 ou 1 */
function computeUncertainty(c) {
  const conf = Number(c.aiConfidence || 0.5);
  return +(1 - Math.abs(conf - 0.5) * 2).toFixed(4);
}

/**
 * computeSurprise : 1 − IoU → max si IoU=0 (désaccord total), min si IoU=1.
 * Si IoU non dispo (pas de maskMetrics), on utilise la coverage comme proxy
 * (un user qui peint beaucoup signale un désaccord). */
function computeSurprise(c) {
  if (typeof c.iou === 'number') return +(1 - c.iou).toFixed(4);
  if (c.coveragePercent > 0) return Math.min(0.8, c.coveragePercent / 20);
  return 0.3;
}

/**
 * kmeansSimple : implémentation K-Means en JS pur. Pas optimisé pour
 * gros datasets mais suffit pour ~200 cas × 5 features.
 * Returns: { centroids, assignments }
 *
 * Init : K-Means++ (premier centroïde random, suivants choisis par
 * proportional sampling de la distance au plus proche centroïde existant).
 * Iter max : 30 (convergence rapide sur ce volume). */
function kmeansSimple(points, k, maxIter = 30) {
  if (points.length === 0) return { centroids: [], assignments: [] };
  if (k >= points.length) {
    return {
      centroids: points.map(p => [...p]),
      assignments: points.map((_, i) => i),
    };
  }

  /* K-Means++ init */
  const centroids = [points[Math.floor(Math.random() * points.length)].slice()];
  while (centroids.length < k) {
    const distances = points.map(p => {
      let min = Infinity;
      for (const c of centroids) {
        const d = euclidDist(p, c);
        if (d < min) min = d;
      }
      return min * min;
    });
    const sum = distances.reduce((a, b) => a + b, 0);
    let target = Math.random() * sum;
    let next = points[0];
    for (let i = 0; i < points.length; i++) {
      target -= distances[i];
      if (target <= 0) { next = points[i]; break; }
    }
    centroids.push(next.slice());
  }

  let assignments = new Array(points.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    /* Assign step */
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let bestIdx = 0, bestDist = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const d = euclidDist(points[i], centroids[j]);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (assignments[i] !== bestIdx) {
        assignments[i] = bestIdx;
        changed = true;
      }
    }
    if (!changed) break;
    /* Update step */
    const sums = centroids.map(() => new Array(points[0].length).fill(0));
    const counts = new Array(centroids.length).fill(0);
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < points[i].length; d++) sums[c][d] += points[i][d];
    }
    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < centroids[c].length; d++) centroids[c][d] = sums[c][d] / counts[c];
    }
  }
  return { centroids, assignments };
}

function euclidDist(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function parseList(arr) {
  return (arr || []).map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

function serializeCandidate(c) {
  /* Sortie compacte pour l'admin — pas la photo, juste les metadata + scores
     pour permettre de décider quoi annoter dans annotate.html. */
  return {
    id: c.id,
    timestamp: c.timestamp,
    clusterId: c.clusterId,
    uncertaintyScore: c.uncertaintyScore,
    surpriseScore: c.surpriseScore,
    combinedScore: c.combinedScore,
    iou: c.iou,
    fpr: c.fpr,
    fnr: c.fnr,
    f1: c.f1,
    aiConfidence: c.aiConfidence,
    learningWeight: c.learningWeight,
    trustScore: c.trustScore,
    feedbackQualityScore: c.feedbackQualityScore,
    coveragePercent: c.coveragePercent,
    establishmentType: c.establishmentType,
    moment: c.moment,
    detection: c.detection,
    identification: c.identification,
    scoreFeedback: c.scoreFeedback,
    comment: c.comment ? c.comment.slice(0, 120) : null,
    downloadUrl: `/api/lucens-cases?mode=download&id=${c.id}`,
  };
}

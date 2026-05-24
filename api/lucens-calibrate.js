/**
 * /api/lucens-calibrate — Calibration de la confidence Claude (Vague 3 P2)
 *
 * Gemini Livrable 3 : le modèle Claude Opus 4.7 produit une `confidence`
 * scalaire 0-1 par zone détectée. Mais cette confidence est-elle bien
 * calibrée ? Si le modèle dit "0.8" est-ce réellement vrai 80% du temps ?
 *
 * Méthodologie (Guo et al. 2017) :
 *   1. Vérité terrain : IoU > 0.5 sur le masque correctif = positif
 *   2. Bins de confidence (10 bins de 0.0-0.1, 0.1-0.2, etc.)
 *   3. Reliability curve : pour chaque bin, taux de vrais positifs réel
 *   4. ECE (Expected Calibration Error) = moyenne pondérée |conf − accuracy|
 *   5. Isotonic Regression via PAV (Pool Adjacent Violators) pour produire
 *      un mapping calibrated_conf à appliquer en post-traitement
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT.
 *
 * GET → retourne :
 *   - bins : reliability diagram data
 *   - ece, mce : métriques de calibration
 *   - mapping : tableau {input, output} pour recalibrer côté frontend
 *
 * Sortie utilisable pour mettre à jour le post-traitement `capZoneConfidence`
 * côté frontend afin de corriger les confidences brutes du modèle.
 *
 * Référence : Guo, Pleiss, Sun, Weinberger, "On Calibration of Modern
 * Neural Networks", ICML 2017.
 */

import { applyCors } from './_lib/security.js';

const N_BINS = 10;
const POSITIVE_IOU_THRESHOLD = 0.5;
const MAX_CASES_SCAN = 300;
const MIN_SAMPLES_FOR_VALID = 30;   /* en-dessous on ne livre pas de mapping */

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

  try {
    const { kv } = await import('@vercel/kv');
    const list = await kv.lrange('lucens:cases:list', 0, MAX_CASES_SCAN - 1).catch(() => []);
    const candidates = parseList(list);
    if (!candidates.length) {
      return res.status(200).json({
        ok: true,
        ready: false,
        message: 'Aucun cas disponible. Calibration impossible.',
        samples: 0,
      });
    }

    /* Fetch des cas complets — uniquement ceux avec maskMetrics */
    const samples = [];
    const BATCH = 20;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const docs = await Promise.all(slice.map(c =>
        kv.get(`lucens:cases:${c.id}`).then(raw => {
          try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
        }).catch(() => null)
      ));
      for (const doc of docs) {
        if (!doc) continue;
        if (typeof doc.trustScore === 'number' && doc.trustScore < 0.3) continue;
        const m = doc.maskMetrics;
        if (!m || typeof m.iou !== 'number') continue;
        /* On considère que la confidence IA est approximée par le riskScore
           normalisé (0-1) du contexte. Pour avoir une vraie confidence par
           zone, il faudrait stocker le tableau zones[] avec leurs confidences
           individuelles dans le case — à activer en Vague 4. */
        const ctx = doc.feedbackContext?.originalAnalysis || {};
        const aiConf = typeof ctx.riskScore === 'number'
          ? Math.max(0.05, Math.min(0.95, 0.5 + (ctx.riskScore - 50) / 200))
          : null;
        if (aiConf === null) continue;
        const label = m.iou >= POSITIVE_IOU_THRESHOLD ? 1 : 0;
        samples.push({ conf: aiConf, label, iou: m.iou });
      }
    }

    if (samples.length < MIN_SAMPLES_FOR_VALID) {
      return res.status(200).json({
        ok: true,
        ready: false,
        message: `Échantillon insuffisant (${samples.length} cas, minimum ${MIN_SAMPLES_FOR_VALID}). Continuez à collecter du feedback.`,
        samples: samples.length,
      });
    }

    /* Reliability diagram + ECE/MCE */
    const reliability = computeReliability(samples, N_BINS);
    const { ece, mce } = computeECE_MCE(reliability);

    /* Isotonic regression via Pool Adjacent Violators (PAV)
       Produit une fonction monotone qui mappe conf brut → conf calibré. */
    const mapping = isotonicRegression(samples);

    /* Mapping discret en 21 points (0.0, 0.05, ..., 1.0) pour usage frontend */
    const discreteMapping = [];
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      discreteMapping.push({
        input: +x.toFixed(2),
        output: +applyMapping(mapping, x).toFixed(4),
      });
    }

    return res.status(200).json({
      ok: true,
      ready: true,
      samples: samples.length,
      methodology: {
        algorithm: 'Isotonic Regression (PAV) + ECE/MCE',
        bins: N_BINS,
        positiveIouThreshold: POSITIVE_IOU_THRESHOLD,
        reference: 'Guo et al. 2017, On Calibration of Modern Neural Networks',
      },
      reliability,
      ece: +ece.toFixed(4),
      mce: +mce.toFixed(4),
      interpretation: interpretECE(ece),
      mapping: discreteMapping,
      rawPavStops: mapping,
    });
  } catch (err) {
    console.error('[CALIBRATE_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

/* ─── Algorithmes ──────────────────────────────────────────── */

/**
 * computeReliability : reliability diagram data.
 * Pour chaque bin, calcule la confidence moyenne et l'accuracy moyenne. */
function computeReliability(samples, nBins) {
  const bins = Array.from({ length: nBins }, () => ({ count: 0, confSum: 0, posSum: 0 }));
  for (const s of samples) {
    const idx = Math.min(nBins - 1, Math.floor(s.conf * nBins));
    bins[idx].count++;
    bins[idx].confSum += s.conf;
    bins[idx].posSum += s.label;
  }
  return bins.map((b, i) => ({
    bin: i,
    range: [+(i / nBins).toFixed(2), +((i + 1) / nBins).toFixed(2)],
    count: b.count,
    avgConfidence: b.count > 0 ? +(b.confSum / b.count).toFixed(4) : null,
    accuracy: b.count > 0 ? +(b.posSum / b.count).toFixed(4) : null,
    gap: b.count > 0 ? +((b.confSum / b.count) - (b.posSum / b.count)).toFixed(4) : null,
  }));
}

/**
 * computeECE_MCE : Expected Calibration Error et Maximum Calibration Error. */
function computeECE_MCE(bins) {
  const total = bins.reduce((a, b) => a + b.count, 0);
  if (total === 0) return { ece: 0, mce: 0 };
  let ece = 0, mce = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const gap = Math.abs(b.avgConfidence - b.accuracy);
    ece += (b.count / total) * gap;
    if (gap > mce) mce = gap;
  }
  return { ece, mce };
}

function interpretECE(ece) {
  if (ece < 0.05) return 'Calibration excellente. La confidence du modèle est fiable.';
  if (ece < 0.10) return 'Calibration acceptable. La confidence est globalement fiable mais peut être améliorée par post-traitement.';
  if (ece < 0.20) return 'Calibration médiocre. Le modèle est sur-confiant ou sous-confiant sur certains paliers. Mapping isotonique recommandé.';
  return 'Calibration mauvaise. Le modèle ment sur sa confidence. Appliquer impérativement le mapping isotonique en post-processing.';
}

/**
 * isotonicRegression via Pool Adjacent Violators (PAV) :
 * Algorithme classique pour fitter une fonction monotone non-décroissante.
 * Garantit que f(x) calibré est lui-même monotone (cohérent avec l'intuition
 * "plus confiance brute → plus de chance d'être correct").
 *
 * Input : samples [{conf, label}]
 * Output : { stops: [{x, y}], ... } points de discontinuité de la step function. */
function isotonicRegression(samples) {
  /* Tri par conf croissant */
  const sorted = [...samples].sort((a, b) => a.conf - b.conf);
  /* Initialisation : chaque sample = un "pool" de poids 1, valeur = label */
  const pools = sorted.map(s => ({ x: s.conf, sum: s.label, weight: 1 }));
  /* PAV : tant que la séquence n'est pas monotone, fusionner les pools */
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pools.length - 1; i++) {
      const mean1 = pools[i].sum / pools[i].weight;
      const mean2 = pools[i + 1].sum / pools[i + 1].weight;
      if (mean1 > mean2) {
        pools[i] = {
          x: pools[i].x,
          sum: pools[i].sum + pools[i + 1].sum,
          weight: pools[i].weight + pools[i + 1].weight,
          xMax: pools[i + 1].xMax !== undefined ? pools[i + 1].xMax : pools[i + 1].x,
        };
        pools.splice(i + 1, 1);
        changed = true;
        break;
      }
    }
  }
  /* Conversion en stops {x, y} */
  return pools.map(p => ({
    xMin: p.x,
    xMax: p.xMax !== undefined ? p.xMax : p.x,
    y: +(p.sum / p.weight).toFixed(4),
  }));
}

/**
 * applyMapping : applique le mapping PAV à une valeur x donnée.
 * Recherche le pool qui couvre x et retourne sa valeur calibrée. */
function applyMapping(stops, x) {
  if (!stops.length) return x;
  /* Avant le premier stop : valeur du premier */
  if (x <= stops[0].xMin) return stops[0].y;
  /* Après le dernier stop : valeur du dernier */
  if (x >= stops[stops.length - 1].xMax) return stops[stops.length - 1].y;
  /* Recherche dans les stops */
  for (const s of stops) {
    if (x >= s.xMin && x <= s.xMax) return s.y;
  }
  /* Interpolation linéaire entre les stops si x tombe dans un trou */
  for (let i = 0; i < stops.length - 1; i++) {
    if (x > stops[i].xMax && x < stops[i + 1].xMin) {
      const t = (x - stops[i].xMax) / (stops[i + 1].xMin - stops[i].xMax);
      return stops[i].y + t * (stops[i + 1].y - stops[i].y);
    }
  }
  return x;
}

function parseList(arr) {
  return (arr || []).map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

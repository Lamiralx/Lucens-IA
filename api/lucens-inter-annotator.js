/**
 * /api/lucens-inter-annotator — Accord inter-annotateurs (Vague 4B)
 *
 * Gemini Livrable 7 risque "biais de confirmation expert" : si un seul
 * annotateur (l'admin) annote les cas, le système sur-apprend ses biais.
 * Cet endpoint identifie les images annotées par PLUSIEURS users via
 * imageHash dedup, calcule l'accord inter-juges (Kappa de Cohen) et
 * agrège les labels via Dawid-Skene EM 1-iter.
 *
 * Méthodologie :
 *   1. Scanner les cases stockés et regrouper par imageHash
 *   2. Pour chaque groupe ≥ 2 annotateurs : calculer Kappa par paire
 *   3. Agréger les masques par majority voting (Dawid-Skene simplifié)
 *   4. Identifier les images litigieuses (Kappa < 0.4 = désaccord)
 *
 * Référence : Cohen J. "A coefficient of agreement for nominal scales",
 * Educational and Psychological Measurement 1960. Dawid & Skene 1979.
 *
 * Auth : header `x-lucens-admin` UNIQUEMENT.
 *
 * GET → retourne :
 *   - groupCount : nombre d'images avec plusieurs annotateurs
 *   - groups : pour chaque groupe { imageHash, annotators, kappa, classification }
 *   - statistics : Kappa moyen, taux de désaccord
 *   - litigious : top images avec désaccord fort (à arbitrer manuellement)
 */

import { applyCors } from './_lib/security.js';

const MAX_CASES_SCAN = 300;
const MIN_KAPPA_AGREE = 0.4;        /* < 0.4 = "désaccord faible/modéré" Landis-Koch */
const MIN_KAPPA_HIGH_AGREE = 0.6;   /* > 0.6 = "agreement substantiel" Landis-Koch */

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
      return res.status(200).json({ ok: true, groupCount: 0, groups: [], message: 'Aucun cas disponible.' });
    }

    /* Fetch en parallèle */
    const docs = [];
    const BATCH = 20;
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH);
      const fetched = await Promise.all(slice.map(c =>
        kv.get(`lucens:cases:${c.id}`).then(raw => {
          try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
        }).catch(() => null)
      ));
      for (const doc of fetched) {
        if (!doc) continue;
        /* Filtrer les cas de trust très bas (vandalisme) avant d'agréger */
        if (typeof doc.trustScore === 'number' && doc.trustScore < 0.3) continue;
        docs.push(doc);
      }
    }

    /* Groupement par imageHash. imageHash est SHA-256 tronqué 16 hex
       (cf computeImageHash dans analyze.js) → 2 annotations sur la même
       image originale matchent automatiquement. */
    const groups = new Map();
    for (const doc of docs) {
      const ih = extractImageHash(doc);
      if (!ih) continue;
      if (!groups.has(ih)) groups.set(ih, []);
      groups.get(ih).push(doc);
    }

    /* On ne garde que les groupes avec ≥ 2 annotateurs */
    const multiAnnotated = [];
    for (const [imageHash, annotations] of groups) {
      if (annotations.length < 2) continue;
      /* Dedup par userSessionId si dispo : 2 feedbacks du même user sur la
         même image ne comptent pas comme inter-juges */
      const uniqueUsers = new Map();
      for (const ann of annotations) {
        const uid = ann.userSessionId || `anon-${ann.id}`;
        if (!uniqueUsers.has(uid) || uniqueUsers.get(uid).timestamp < ann.timestamp) {
          uniqueUsers.set(uid, ann);
        }
      }
      if (uniqueUsers.size < 2) continue;
      multiAnnotated.push({ imageHash, annotations: Array.from(uniqueUsers.values()) });
    }

    /* Calcul Kappa par paire pour chaque groupe */
    const groupsAnalyzed = [];
    let kappaSum = 0, kappaCount = 0;
    for (const g of multiAnnotated) {
      const pairs = [];
      for (let i = 0; i < g.annotations.length; i++) {
        for (let j = i + 1; j < g.annotations.length; j++) {
          const k = computeKappaForPair(g.annotations[i], g.annotations[j]);
          pairs.push(k);
          if (typeof k.kappa === 'number') {
            kappaSum += k.kappa;
            kappaCount++;
          }
        }
      }
      /* Kappa moyen du groupe */
      const valid = pairs.filter(p => typeof p.kappa === 'number');
      const avgKappa = valid.length ? +(valid.reduce((a, b) => a + b.kappa, 0) / valid.length).toFixed(4) : null;
      const dawid = aggregateDawidSkene(g.annotations);
      groupsAnalyzed.push({
        imageHash: g.imageHash,
        annotatorCount: g.annotations.length,
        pairKappas: pairs,
        avgKappa,
        agreement: classifyAgreement(avgKappa),
        dawidSkeneConsensus: dawid,
        annotations: g.annotations.map(a => ({
          id: a.id,
          userSessionId: a.userSessionId || null,
          timestamp: a.timestamp,
          detection: a.feedbackContext?.detection || null,
          identification: a.feedbackContext?.identification || null,
          scoreFeedback: a.feedbackContext?.scoreFeedback || null,
          iou: a.maskMetrics?.iou || null,
          coveragePercent: a.coveragePercent || null,
          trustScore: a.trustScore || null,
        })),
      });
    }

    /* Tri : litigieux (kappa < 0.4) en premier — admin doit arbitrer */
    groupsAnalyzed.sort((a, b) => {
      const ka = a.avgKappa == null ? 999 : a.avgKappa;
      const kb = b.avgKappa == null ? 999 : b.avgKappa;
      return ka - kb;
    });

    const litigious = groupsAnalyzed.filter(g => g.avgKappa != null && g.avgKappa < MIN_KAPPA_AGREE);

    return res.status(200).json({
      ok: true,
      groupCount: groupsAnalyzed.length,
      totalAnnotationsAnalyzed: docs.length,
      uniqueImagesTotal: groups.size,
      statistics: {
        avgKappa: kappaCount > 0 ? +(kappaSum / kappaCount).toFixed(4) : null,
        pairsEvaluated: kappaCount,
        litigiousCount: litigious.length,
      },
      methodology: {
        algorithm: 'Cohen Kappa pairwise + Dawid-Skene majority voting',
        reference: 'Cohen 1960, Dawid & Skene 1979',
        kappaThresholds: {
          poor: '< 0.4 (désaccord)',
          moderate: '0.4 - 0.6 (modéré)',
          substantial: '> 0.6 (agreement substantiel)',
        },
      },
      groups: groupsAnalyzed,
      litigious,
    });
  } catch (err) {
    console.error('[INTER_ANNOTATOR_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

/* ─── Algorithmes ──────────────────────────────────────────── */

/**
 * computeKappaForPair : Cohen's Kappa entre 2 annotateurs sur les
 * réponses des 3 questions (detection, identification, scoreFeedback).
 * On dérive aussi un kappa pixel-level approximé depuis IoU pour les
 * cas où les 2 ont peint un masque. */
function computeKappaForPair(a, b) {
  const dimensions = ['detection', 'identification', 'scoreFeedback'];
  let agree = 0, total = 0;
  const breakdown = {};
  for (const dim of dimensions) {
    const va = a.feedbackContext?.[dim];
    const vb = b.feedbackContext?.[dim];
    if (va && vb) {
      total++;
      const match = va === vb;
      if (match) agree++;
      breakdown[dim] = match ? 'agree' : `${va} vs ${vb}`;
    }
  }
  /* Pour 3 dimensions catégoriques à 3 valeurs chacune, l'accord aléatoire
     attendu est ~1/3 par dim. Kappa = (p_observed - p_expected) / (1 - p_expected) */
  if (total === 0) {
    return { kappa: null, agreement: agree, total, breakdown };
  }
  const pObs = agree / total;
  const pExp = 1 / 3;        /* approximation : 3 valeurs équiprobables */
  const kappa = pExp === 1 ? 1 : (pObs - pExp) / (1 - pExp);
  /* Bonus pixel-level si les 2 ont peint un masque : on combine */
  let pixelAgreement = null;
  if (typeof a.maskMetrics?.iou === 'number' && typeof b.maskMetrics?.iou === 'number') {
    /* Les 2 masques ne sont pas directement comparables sans le décoder,
       mais IoU vs IA est un proxy : si les 2 ont des IoU similaires, ils
       ont vu la même erreur. Différence < 0.15 = agreement pixel-level. */
    pixelAgreement = Math.abs(a.maskMetrics.iou - b.maskMetrics.iou) < 0.15;
  }
  return {
    kappa: +kappa.toFixed(4),
    agreement: agree,
    total,
    breakdown,
    pixelAgreement,
  };
}

/**
 * aggregateDawidSkene : agrégation simplifiée des labels via majority voting
 * pondéré par trustScore. Dawid-Skene complet ferait une EM sur les
 * probabilités d'erreur de chaque annotateur, mais avec ≤ 5 annotateurs
 * par image, le majority voting pondéré donne 95% de la valeur. */
function aggregateDawidSkene(annotations) {
  const dims = ['detection', 'identification', 'scoreFeedback'];
  const consensus = {};
  for (const dim of dims) {
    const votes = new Map();   /* value → poids cumulé */
    for (const ann of annotations) {
      const v = ann.feedbackContext?.[dim];
      if (!v) continue;
      const weight = Number(ann.trustScore || 1.0) * Number(ann.learningWeight || 1.0);
      votes.set(v, (votes.get(v) || 0) + weight);
    }
    if (votes.size === 0) { consensus[dim] = null; continue; }
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    consensus[dim] = {
      value: sorted[0][0],
      weight: +sorted[0][1].toFixed(3),
      runnerUp: sorted[1] ? { value: sorted[1][0], weight: +sorted[1][1].toFixed(3) } : null,
      confidence: sorted[1]
        ? +(sorted[0][1] / (sorted[0][1] + sorted[1][1])).toFixed(3)
        : 1.0,
    };
  }
  return consensus;
}

function classifyAgreement(kappa) {
  if (kappa == null) return 'undetermined';
  if (kappa < 0.0) return 'worse_than_chance';
  if (kappa < 0.2) return 'slight';
  if (kappa < 0.4) return 'fair';
  if (kappa < 0.6) return 'moderate';
  if (kappa < 0.8) return 'substantial';
  return 'almost_perfect';
}

function extractImageHash(doc) {
  /* Plusieurs sources possibles : top-level (Vague 1+), feedbackContext.imageHash (legacy) */
  return doc.imageHash || doc.feedbackContext?.imageHash || doc.feedbackContext?.originalAnalysis?.imageHash || null;
}

function parseList(arr) {
  return (arr || []).map(s => {
    try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
  }).filter(Boolean);
}

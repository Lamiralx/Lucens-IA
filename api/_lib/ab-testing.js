/**
 * Vague 3 — A/B testing du SYSTEM_PROMPT (ChatGPT Mission 5)
 *
 * Allocation déterministe par hash SHA-256 : un même utilisateur (session
 * stable) ou une même image (imageHash) tombe toujours dans la même variante.
 * Évite le bias de switching et permet de pistes feedback ↔ variante.
 *
 * Stats trackées par variante :
 *   - feedback_total
 *   - feedback_negative
 *   - missed_zones, false_positives
 *   - consent_training
 *
 * Décision : Z-test 2 proportions (fréquentiste, conservateur).
 * Guardrails de promotion : ne JAMAIS promouvoir B si missed_zones augmente
 * de plus de N points (= dégradation critique du rappel).
 *
 * Config par expériment stockée en KV : lucens:experiments:config:<id>
 */

import crypto from 'crypto';

/**
 * assignPromptVariant : allocation déterministe stable.
 *
 * Bucketing par ordre de priorité :
 *   1. userSessionId si fourni (stable cross-analyse)
 *   2. imageHash sinon (stable cross-utilisateur sur la même image)
 *   3. random UUID en dernier recours (allocation pure)
 *
 * traffic : {A: 0.5, B: 0.5} ou plus complexe. La somme doit ≤ 1.
 */
export function assignPromptVariant({ experimentId, userSessionId, imageHash, traffic }) {
  const tr = traffic || { A: 0.5, B: 0.5 };
  const key = `${experimentId}:${userSessionId || imageHash || crypto.randomUUID()}`;
  const h = crypto.createHash('sha256').update(key).digest('hex');
  const n = parseInt(h.slice(0, 8), 16) / 0xffffffff;     /* 0..1 */
  let cum = 0;
  for (const [variant, p] of Object.entries(tr)) {
    cum += p;
    if (n < cum) return variant;
  }
  return Object.keys(tr)[0];
}

/**
 * recordVariantOutcome : trackage des outcomes par variante.
 * Appelé depuis /api/feedback.js avec le payload {detection, identification,
 * scoreFeedback, consentTraining} + variantId connu via le contexte.
 */
export async function recordVariantOutcome(kv, experimentId, variantId, outcome) {
  if (!experimentId || !variantId) return;
  const key = `lucens:experiments:${experimentId}:variant:${variantId}`;
  try {
    await kv.hincrby(key, 'feedback_total', 1);
    if (outcome.isNegative) await kv.hincrby(key, 'feedback_negative', 1);
    if (outcome.detection === 'missed_zones') await kv.hincrby(key, 'missed_zones', 1);
    if (outcome.detection === 'false_positives') await kv.hincrby(key, 'false_positives', 1);
    if (outcome.consentTraining === true) await kv.hincrby(key, 'consent_training', 1);
    if (typeof outcome.learningWeight === 'number') {
      await kv.hincrby(key, 'learning_sum_x100', Math.round(outcome.learningWeight * 100));
    }
  } catch { /* fail-silent : ne pas bloquer le feedback si KV bug */ }
}

/**
 * evaluateExperiment : prend la config + les stats des 2 variantes,
 * retourne une décision { decision, reason, statisticalSignificance }.
 *
 * Decisions possibles :
 *   - 'continue' : pas assez de data ou pas de gagnant clair
 *   - 'promote_B' : B est statistiquement meilleur, on déploie B sur 100%
 *   - 'rollback_B' : B a dégradé un KPI critique (guardrail violé)
 */
export function evaluateExperiment({ A, B, config }) {
  const aTotal = Number(A.feedback_total || 0);
  const bTotal = Number(B.feedback_total || 0);
  const minN = config?.minFeedbackPerArm || 150;
  if (aTotal < minN || bTotal < minN) {
    return {
      decision: 'continue',
      reason: `Échantillon insuffisant (A=${aTotal}, B=${bTotal}, min=${minN} par arm).`,
      statisticalSignificance: null,
    };
  }

  const aNeg = Number(A.feedback_negative || 0) / aTotal;
  const bNeg = Number(B.feedback_negative || 0) / bTotal;
  const aMiss = Number(A.missed_zones || 0) / aTotal;
  const bMiss = Number(B.missed_zones || 0) / bTotal;
  const aFP = Number(A.false_positives || 0) / aTotal;
  const bFP = Number(B.false_positives || 0) / bTotal;

  const guardrails = config?.guardrails || {
    maxNegativeRateDeltaPoints: 5,
    maxMissedZonesDeltaPoints: 3,
    maxFalsePositivesDeltaPoints: 5,
  };
  const negDeltaPts = (bNeg - aNeg) * 100;
  const missDeltaPts = (bMiss - aMiss) * 100;
  const fpDeltaPts = (bFP - aFP) * 100;

  /* Guardrails — rollback automatique si B dégrade un KPI critique */
  if (missDeltaPts > guardrails.maxMissedZonesDeltaPoints) {
    return {
      decision: 'rollback_B',
      reason: `B dégrade le taux de missed_zones de ${missDeltaPts.toFixed(2)} points (guardrail ${guardrails.maxMissedZonesDeltaPoints}).`,
      statisticalSignificance: null,
    };
  }
  if (negDeltaPts > guardrails.maxNegativeRateDeltaPoints) {
    return {
      decision: 'rollback_B',
      reason: `B dégrade le taux de feedback négatif de ${negDeltaPts.toFixed(2)} points (guardrail ${guardrails.maxNegativeRateDeltaPoints}).`,
      statisticalSignificance: null,
    };
  }
  if (fpDeltaPts > guardrails.maxFalsePositivesDeltaPoints) {
    return {
      decision: 'rollback_B',
      reason: `B dégrade le taux de false_positives de ${fpDeltaPts.toFixed(2)} points (guardrail ${guardrails.maxFalsePositivesDeltaPoints}).`,
      statisticalSignificance: null,
    };
  }

  /* Test stat : Z-test 2 proportions sur le taux de feedback négatif.
     Si B est meilleur (bNeg < aNeg) ET significatif (p < 0.05) → promote.
     Sinon → continue (collecte plus de data). */
  const ztest = twoProportionZTest({
    successA: Number(A.feedback_negative || 0),
    totalA: aTotal,
    successB: Number(B.feedback_negative || 0),
    totalB: bTotal,
  });

  if (bNeg < aNeg && ztest.pApprox < 0.05) {
    return {
      decision: 'promote_B',
      reason: `B améliore le taux négatif (B=${(bNeg * 100).toFixed(2)}% vs A=${(aNeg * 100).toFixed(2)}%, p≈${ztest.pApprox}).`,
      statisticalSignificance: ztest,
    };
  }

  return {
    decision: 'continue',
    reason: `Pas de différence statistiquement significative (p≈${ztest.pApprox}). Continuer la collecte.`,
    statisticalSignificance: ztest,
  };
}

/* ─── Helpers statistiques ──────────────────────────────────── */

export function twoProportionZTest({ successA, totalA, successB, totalB }) {
  const p1 = successA / Math.max(1, totalA);
  const p2 = successB / Math.max(1, totalB);
  const pooled = (successA + successB) / Math.max(1, totalA + totalB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / totalA + 1 / totalB));
  const z = se === 0 ? 0 : (p2 - p1) / se;
  const pApprox = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    z: +z.toFixed(4),
    pApprox: +pApprox.toFixed(4),
    pA: +p1.toFixed(4),
    pB: +p2.toFixed(4),
  };
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x) {
  /* Approximation Abramowitz & Stegun 7.1.26, erreur < 1.5e-7 */
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

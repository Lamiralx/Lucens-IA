/**
 * Vague 4 — Réputation utilisateur (sans login)
 *
 * Pour chaque userSessionId stable (UUID v4 localStorage côté client),
 * on agrège l'historique de ses feedbacks pour :
 *
 *   1. Anti-data-poisoning : un user dont les trustScores sont
 *      systématiquement bas (vandalisme, gribouillage, lavage de mains)
 *      voit ses futurs feedbacks pondérés à la baisse, même si chaque
 *      feedback isolé pourrait passer le quality gate.
 *
 *   2. Reconnaissance (gamification non intrusive) : un user fiable
 *      qui a donné N feedbacks de haute qualité reçoit un badge
 *      "contributeur qualité" qui le motive à continuer.
 *
 *   3. Plafonnement du nombre de feedbacks bruyants : un même user
 *      ne peut pas inonder la base avec 50 feedbacks vandalisés —
 *      on rejette / déprioritise après un seuil.
 *
 * Stockage Vercel KV :
 *   - lucens:user:<sessionId>  →  Hash { count, qualitySum, trustSum,
 *                                        casesWithMask, lastSeen,
 *                                        firstSeen, lowTrustStreak }
 *   - lucens:user:badges:<sessionId>  →  Set des badges débloqués
 *
 * Anti-poisoning : la pondération finale d'un feedback devient
 *   weightedTrust = currentTrust × historyMultiplier
 * où historyMultiplier ∈ [0.10, 1.20] selon la trustScore moyenne
 * historique du user.
 */

const BADGES = {
  FIRST_FEEDBACK: { id: 'first_feedback', threshold: { count: 1 } },
  CONTRIBUTOR: { id: 'contributor', threshold: { count: 5, avgQuality: 50 } },
  EXPERT: { id: 'expert', threshold: { count: 15, avgQuality: 70, casesWithMask: 3 } },
  MENTOR: { id: 'mentor', threshold: { count: 50, avgQuality: 80, casesWithMask: 10 } },
};

const POISONING_THRESHOLD_STREAK = 3;     /* 3 feedbacks trust < 0.3 d'affilée = signal poisoning */
const POISONING_RATE_THRESHOLD = 0.5;     /* > 50% des feedbacks trust bas = user toxique */

/**
 * recordUserContribution : appelé après chaque feedback validé pour
 * mettre à jour les compteurs et débloquer les badges éventuels.
 * Retourne la nouvelle réputation + les badges débloqués cette fois. */
export async function recordUserContribution(kv, userSessionId, {
  feedbackQualityScore,
  trustScore,
  hasMask,
  isNegative,
}) {
  if (!userSessionId || typeof userSessionId !== 'string' || userSessionId.length < 8) {
    return { reputation: null, newBadges: [] };
  }
  if (!/^[a-z0-9-]+$/i.test(userSessionId)) {
    return { reputation: null, newBadges: [] };
  }
  const key = `lucens:user:${userSessionId}`;
  const badgesKey = `lucens:user:badges:${userSessionId}`;
  const now = Date.now();

  try {
    /* Incrémentations atomiques */
    await kv.hincrby(key, 'count', 1);
    await kv.hincrby(key, 'qualitySum', Number(feedbackQualityScore || 0));
    await kv.hincrby(key, 'trustSum_x100', Math.round(Number(trustScore || 0) * 100));
    if (hasMask) await kv.hincrby(key, 'casesWithMask', 1);
    if (isNegative) await kv.hincrby(key, 'negativeCount', 1);

    /* Streak de bas trust pour détection poisoning */
    if (trustScore < 0.3) {
      await kv.hincrby(key, 'lowTrustStreak', 1);
      await kv.hincrby(key, 'lowTrustTotal', 1);
    } else {
      await kv.hset(key, { lowTrustStreak: 0 });
    }

    /* Timestamps */
    const existing = await kv.hgetall(key);
    if (!existing.firstSeen) await kv.hset(key, { firstSeen: now });
    await kv.hset(key, { lastSeen: now });

    /* TTL 18 mois (RGPD) — sera réinitialisé à chaque contribution */
    await kv.expire(key, 60 * 60 * 24 * 540);

    /* Détection des badges nouvellement débloqués */
    const reputation = await getUserReputation(kv, userSessionId);
    const currentBadges = new Set((await kv.smembers(badgesKey).catch(() => [])) || []);
    const newBadges = [];
    for (const [name, badge] of Object.entries(BADGES)) {
      if (currentBadges.has(badge.id)) continue;
      if (badgeEarned(reputation, badge.threshold)) {
        await kv.sadd(badgesKey, badge.id);
        await kv.expire(badgesKey, 60 * 60 * 24 * 540);
        newBadges.push({ id: badge.id, key: name });
      }
    }

    return { reputation, newBadges };
  } catch (e) {
    console.warn('[user-reputation] kv error:', e?.message || e);
    return { reputation: null, newBadges: [] };
  }
}

/**
 * getUserReputation : lit l'état actuel de la réputation. */
export async function getUserReputation(kv, userSessionId) {
  if (!userSessionId) return null;
  try {
    const raw = await kv.hgetall(`lucens:user:${userSessionId}`);
    if (!raw || !raw.count) return null;
    const count = Number(raw.count || 0);
    const qualitySum = Number(raw.qualitySum || 0);
    const trustSum = Number(raw.trustSum_x100 || 0);
    const negativeCount = Number(raw.negativeCount || 0);
    return {
      count,
      avgQuality: count > 0 ? Math.round(qualitySum / count) : 0,
      avgTrust: count > 0 ? +(trustSum / count / 100).toFixed(3) : 0,
      casesWithMask: Number(raw.casesWithMask || 0),
      negativeRate: count > 0 ? +(negativeCount / count).toFixed(3) : 0,
      lowTrustStreak: Number(raw.lowTrustStreak || 0),
      lowTrustTotal: Number(raw.lowTrustTotal || 0),
      lowTrustRate: count > 0 ? +(Number(raw.lowTrustTotal || 0) / count).toFixed(3) : 0,
      firstSeen: Number(raw.firstSeen || 0),
      lastSeen: Number(raw.lastSeen || 0),
    };
  } catch { return null; }
}

/**
 * getHistoryMultiplier : pondération anti-poisoning à appliquer sur le
 * trustScore d'un nouveau feedback selon l'historique de l'utilisateur.
 *
 * Logique :
 *   - User inconnu (premier feedback) : multiplier = 1.0 (neutre)
 *   - User avec lowTrustRate > 50% sur > 5 feedbacks : multiplier = 0.10
 *     (poisoning probable, feedback ignoré dans le learning)
 *   - User avec avgTrust > 0.8 sur > 5 feedbacks : multiplier = 1.20 (boost)
 *   - Streak 3+ feedbacks trust bas consécutifs : multiplier = 0.20
 *     (signal poisoning court terme même si historique passé OK)
 *   - Sinon : interpolation linéaire 0.5 → 1.0
 */
export function getHistoryMultiplier(reputation) {
  if (!reputation || reputation.count < 1) return 1.0;
  if (reputation.lowTrustStreak >= POISONING_THRESHOLD_STREAK) return 0.20;
  if (reputation.count >= 5 && reputation.lowTrustRate > POISONING_RATE_THRESHOLD) return 0.10;
  if (reputation.count >= 5 && reputation.avgTrust > 0.8) return 1.20;
  /* Interpolation linéaire entre avgTrust 0.3 → 0.5x et 0.8 → 1.0x */
  const t = Math.max(0.3, Math.min(0.8, reputation.avgTrust));
  return +(0.5 + (t - 0.3) / 0.5 * 0.5).toFixed(2);
}

/**
 * effectiveLearningWeightWithHistory : la fonction finale qui pondère
 * un feedback en intégrant son trust score actuel ET l'historique user.
 *
 * weightedTrust = trustCurrent × historyMultiplier
 * → si historyMultiplier < 0.3 → feedback ignoré dans le learning */
export function effectiveLearningWeightWithHistory(quality, trust, reputation) {
  const multiplier = getHistoryMultiplier(reputation);
  const weightedTrust = trust * multiplier;
  if (weightedTrust < 0.3) return 0;
  const qBucket = quality < 25 ? 0 : quality < 50 ? 0.25 : quality < 75 ? 0.6 : 1.0;
  return +(qBucket * Math.min(1, weightedTrust)).toFixed(3);
}

/* ─── Helpers ────────────────────────────────────────────────── */

function badgeEarned(reputation, threshold) {
  if (!reputation) return false;
  if (threshold.count && reputation.count < threshold.count) return false;
  if (threshold.avgQuality && reputation.avgQuality < threshold.avgQuality) return false;
  if (threshold.casesWithMask && reputation.casesWithMask < threshold.casesWithMask) return false;
  return true;
}

export { BADGES };

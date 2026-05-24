/**
 * /api/feedback — Collecte anonyme du feedback utilisateur + capture optionnelle
 *
 * Questions stratégiques au moment du téléchargement PDF :
 *   1. Détection (all_seen / missed_zones / false_positives)
 *   2. Identification (correct / partial / incorrect)
 *   3. Score (correct / off / wrong)
 * + Commentaire optionnel
 * + correctivePhoto + correctiveMask (cas négatifs uniquement, opt-in)
 *
 * Stockage Vercel KV :
 *   - lucens:feedback:recent (1000 derniers, sans photo)
 *   - lucens:stats:YYYY-WXX:{detection,identification,score,total} (compteurs)
 *   - lucens:feedback:negative (200 derniers commentaires négatifs)
 *   - lucens:cases:list (300 derniers index de cas avec photo+masque)
 *   - lucens:cases:<id> (JSON complet d'un cas, format compatible annotate.html)
 *
 * Anti-spam :
 *   - Verrou de 30s par IP via KV (refus si déjà soumis dans les 30 dernières secondes)
 *   - Rate limit 20/h/IP (existant)
 *
 * Aucune PII : pas d'IP stockée dans les enregistrements, pas d'email.
 */

import { applyCors, getClientIp, rateLimit, send429 } from './_lib/security.js';
import { computeFeedbackQuality, computeTrustScore, effectiveLearningWeight, learningWeightFromQuality } from './_lib/feedback-scoring.js';
import { recordVariantOutcome } from './_lib/ab-testing.js';
import { recordUserContribution, getUserReputation, effectiveLearningWeightWithHistory } from './_lib/user-reputation.js';
import crypto from 'crypto';

/* Vague 1 RGPD (ChatGPT P0) : deleteToken cryptographique généré côté
   serveur, retourné une seule fois à l'utilisateur. Seul son hash SHA-256
   est stocké en KV. L'utilisateur peut ensuite invoquer /api/lucens-erasure
   avec son token pour effacer le feedback/case associé sans login.
   EDPB rappelle que pseudonymisation ≠ anonymisation ; ce flow donne un
   droit à l'oubli effectif. */
function generateDeleteToken() {
  return crypto.randomBytes(24).toString('base64url');
}
function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const BURST_LOCK_SEC = 30;
const MAX_PHOTO_BYTES = 600 * 1024;   /* base64 ~600KB → ~450KB binaire */
const MAX_MASK_BYTES  = 200 * 1024;
const NEGATIVE_VALUES = new Set(['missed_zones', 'false_positives', 'partial', 'incorrect', 'off', 'wrong']);

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);

  /* Anti-spam burst : 30s entre 2 submits du même IP. Bloque le clic répété
     qui pollue les stats avec des "all_seen" vides. */
  try {
    const { kv } = await import('@vercel/kv');
    const burstKey = `lucens:fb:burst:${ip}`;
    const exists = await kv.get(burstKey);
    if (exists) {
      return res.status(429).json({
        error: 'Feedback déjà envoyé récemment. Merci d\'attendre 30s.',
        type: 'BurstLockError',
      });
    }
    await kv.set(burstKey, 1, { ex: BURST_LOCK_SEC });
  } catch { /* KV indispo : fail-open, on continue */ }

  /* Rate limit horaire global */
  const rl = await rateLimit({ scope: 'feedback', ip, limit: 20, windowSec: 3600 });
  if (!rl.ok) return send429(res, rl.retryAfter);

  try {
    const body = req.body || {};
    const {
      detection, identification, scoreFeedback, action,
      comment, context, imageHash, lang,
      correctivePhoto,  /* base64 data URL JPEG (≤600KB), opt-in user */
      correctiveMask,   /* base64 data URL PNG (≤200KB), opt-in user */
      consentTraining,  /* booléen explicite */
    } = body;

    if (!detection && !identification && !scoreFeedback && !action && !comment) {
      return res.status(400).json({ error: 'No feedback provided' });
    }

    /* Quality gate : si user clique négatif, on exige soit un commentaire,
       soit une capture corrective. Sinon le feedback est trop pauvre pour
       être exploitable. */
    const isNegative = NEGATIVE_VALUES.has(detection) || NEGATIVE_VALUES.has(identification) || NEGATIVE_VALUES.has(scoreFeedback);
    if (isNegative && !comment && !correctivePhoto) {
      return res.status(400).json({
        error: 'Feedback négatif insuffisant : ajoute un commentaire ou une capture corrective.',
        type: 'QualityGateError',
      });
    }

    const scoreMap = {
      all_seen: 100, correct: 100, yes: 100,
      partial: 50, off: 50,
      no: 0, incorrect: 0, wrong: 0,
      missed_zones: 0, false_positives: 25,
    };
    const thirdQ = scoreFeedback || action;
    const scores = [
      typeof scoreMap[detection] === 'number' ? scoreMap[detection] : null,
      typeof scoreMap[identification] === 'number' ? scoreMap[identification] : null,
      typeof scoreMap[thirdQ] === 'number' ? scoreMap[thirdQ] : null,
    ].filter(s => s !== null);
    const overallScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

    const id = 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    /* deleteToken : retourné en clair UNE FOIS dans la réponse,
       jamais re-stocké en clair. L'utilisateur le conserve (PWA local
       storage / capture écran) pour invoquer /api/lucens-erasure plus tard. */
    const deleteToken = generateDeleteToken();
    const deleteTokenHash = sha256Hex(deleteToken);

    /* Vague 2 — Pipeline Quality + Trust en cascade.
       Quality (ChatGPT) = richesse informationnelle du feedback (0-100).
       Trust (Gemini) = absence de vandalisme/spam/incompréhension (0-1).
       Vague 4 — pondération anti-poisoning par historique utilisateur.
       Le learningWeight final intègre maintenant la réputation du user :
       un user qui poisonn systématiquement voit son nouveau feedback
       pondéré à 0.10× malgré un trustScore actuel correct. */
    const feedbackQualityScore = computeFeedbackQuality({
      detection,
      identification,
      scoreFeedback: thirdQ,
      comment,
      correctivePhoto,
      correctiveMask,
      coveragePercent: body.coveragePercent,
      connectedZonesEstimate: body.connectedZonesEstimate,
      context,
      consentTraining,
      elapsedMs: body.elapsedMs,
      userAgent: req.headers['user-agent'],
    });
    const trustScore = computeTrustScore({
      detection,
      identification,
      scoreFeedback: thirdQ,
      coveragePercent: body.coveragePercent,
      maskMetrics: body.maskMetrics,
      shapeAnalysis: body.shapeAnalysis,
      elapsedMs: body.elapsedMs,
      correctiveMask,
    });
    /* Vague 4 — récupère la réputation user pour pondérer l'apprentissage */
    let userReputation = null;
    let learningWeight;
    if (body.userSessionId) {
      try {
        const { kv } = await import('@vercel/kv');
        userReputation = await getUserReputation(kv, body.userSessionId);
      } catch { /* fail-open : pas de réputation = neutre */ }
    }
    learningWeight = userReputation
      ? effectiveLearningWeightWithHistory(feedbackQualityScore, trustScore, userReputation)
      : effectiveLearningWeight(feedbackQualityScore, trustScore);

    const entry = {
      id,
      timestamp: Date.now(),
      detection: detection || null,
      identification: identification || null,
      scoreFeedback: scoreFeedback || null,
      comment: typeof comment === 'string' ? comment.slice(0, 200) : null,
      context: context || null,
      imageHash: typeof imageHash === 'string' ? imageHash.slice(0, 16) : null,
      lang: typeof lang === 'string' ? lang.slice(0, 4) : null,
      overallScore,
      hasCase: false,
      deleteTokenHash,
      /* Scoring Vague 2 */
      feedbackQualityScore,
      trustScore,
      learningWeight,
      /* Métriques pixel (Gemini Livrable 1) — nullables si pas de capture */
      maskMetrics: body.maskMetrics || null,
      coveragePercent: typeof body.coveragePercent === 'number' ? body.coveragePercent : null,
      connectedZonesEstimate: typeof body.connectedZonesEstimate === 'number' ? body.connectedZonesEstimate : null,
    };

    /* Validation des payloads photo+mask (taille, format dataURL) */
    let caseId = null;
    if (correctivePhoto && correctiveMask && consentTraining === true) {
      const photoOk = typeof correctivePhoto === 'string'
        && correctivePhoto.startsWith('data:image/jpeg;base64,')
        && correctivePhoto.length <= MAX_PHOTO_BYTES * 1.4;
      const maskOk = typeof correctiveMask === 'string'
        && correctiveMask.startsWith('data:image/png;base64,')
        && correctiveMask.length <= MAX_MASK_BYTES * 1.4;
      if (photoOk && maskOk) {
        caseId = 'case_user_' + id;
        entry.hasCase = true;
      }
    }

    let stored = false;
    try {
      const { kv } = await import('@vercel/kv');

      await kv.lpush('lucens:feedback:recent', JSON.stringify(entry));
      await kv.ltrim('lucens:feedback:recent', 0, 999);

      const week = new Date(entry.timestamp);
      const wk = week.getUTCFullYear() + '-W' + Math.ceil(((week - new Date(week.getUTCFullYear(),0,1)) / 86400000 + 1) / 7);
      if (entry.detection)      await kv.hincrby(`lucens:stats:${wk}:detection`, entry.detection, 1);
      if (entry.identification) await kv.hincrby(`lucens:stats:${wk}:identification`, entry.identification, 1);
      if (entry.scoreFeedback)  await kv.hincrby(`lucens:stats:${wk}:score`, entry.scoreFeedback, 1);
      await kv.incr(`lucens:stats:${wk}:total`);

      /* Vague 2 — stats hebdo étendues : quality / trust / consent / cases / iou.
         Permet au dashboard de calculer drift, moyennes pondérées et taux. */
      await kv.hincrby(`lucens:stats:${wk}:quality`, 'sum', feedbackQualityScore);
      await kv.hincrby(`lucens:stats:${wk}:quality`, 'count', 1);
      if (feedbackQualityScore >= 75) await kv.hincrby(`lucens:stats:${wk}:quality`, 'high', 1);
      if (feedbackQualityScore < 25)  await kv.hincrby(`lucens:stats:${wk}:quality`, 'low', 1);
      /* Trust score moyen × 100 (sum d'entiers pour KV) */
      await kv.hincrby(`lucens:stats:${wk}:trust`, 'sum_x100', Math.round(trustScore * 100));
      await kv.hincrby(`lucens:stats:${wk}:trust`, 'count', 1);
      if (trustScore < 0.3) await kv.hincrby(`lucens:stats:${wk}:trust`, 'low_trust', 1);
      /* learningWeight × 100 — sert à mesurer la valeur effective de la
         semaine pour la boucle d'apprentissage */
      await kv.hincrby(`lucens:stats:${wk}:learning`, 'sum_x100', Math.round(learningWeight * 100));
      await kv.hincrby(`lucens:stats:${wk}:learning`, 'count', 1);
      /* Consentement & cases */
      if (consentTraining === true) await kv.hincrby(`lucens:stats:${wk}:consent`, 'training_true', 1);
      else await kv.hincrby(`lucens:stats:${wk}:consent`, 'training_false', 1);
      /* Métriques IoU agrégées si maskMetrics présent */
      if (body.maskMetrics && typeof body.maskMetrics.iou === 'number') {
        await kv.hincrby(`lucens:stats:${wk}:iou`, 'sum_x10000', Math.round(body.maskMetrics.iou * 10000));
        await kv.hincrby(`lucens:stats:${wk}:iou`, 'count', 1);
        await kv.hincrby(`lucens:stats:${wk}:iou`, 'fpr_sum_x10000', Math.round((body.maskMetrics.falsePositiveRatio || 0) * 10000));
        await kv.hincrby(`lucens:stats:${wk}:iou`, 'fnr_sum_x10000', Math.round((body.maskMetrics.falseNegativeRatio || 0) * 10000));
        await kv.hincrby(`lucens:stats:${wk}:iou`, 'f1_sum_x10000', Math.round((body.maskMetrics.f1 || 0) * 10000));
      }

      if (entry.comment && (entry.detection !== 'all_seen' || entry.identification !== 'correct' || entry.scoreFeedback !== 'correct')) {
        await kv.lpush('lucens:feedback:negative', JSON.stringify(entry));
        await kv.ltrim('lucens:feedback:negative', 0, 199);
      }

      /* Vague 3 — Tracking A/B testing.
         Si l'analyse a été produite avec un variantId actif (champ
         activeVariant.variantId dans le _meta de la réponse analyze),
         on incrémente les compteurs de la variante pour évaluation. */
      const activeVariant = body.activeVariant;
      if (activeVariant?.experimentId && activeVariant?.variantId) {
        await recordVariantOutcome(kv, activeVariant.experimentId, activeVariant.variantId, {
          isNegative: ['missed_zones', 'false_positives'].includes(entry.detection)
            || ['partial', 'incorrect'].includes(entry.identification)
            || ['off', 'wrong'].includes(entry.scoreFeedback),
          detection: entry.detection,
          consentTraining,
          learningWeight,
        });
      }

      /* Vague 4 — Enregistrement de la contribution dans la réputation user.
         Le résultat (reputation + newBadges) est retourné au frontend
         pour afficher éventuellement un badge "contributeur qualité". */
      if (body.userSessionId) {
        const contrib = await recordUserContribution(kv, body.userSessionId, {
          feedbackQualityScore,
          trustScore,
          hasMask: !!caseId,
          isNegative: ['missed_zones', 'false_positives'].includes(entry.detection)
            || ['partial', 'incorrect'].includes(entry.identification)
            || ['off', 'wrong'].includes(entry.scoreFeedback),
        });
        userReputation = contrib.reputation;
        entry._newBadges = contrib.newBadges;
      }

      /* Stockage du cas (photo + masque) au format compatible annotate.html.
         Vague 2 : enrichi avec quality/trust/learning/maskMetrics pour
         priorisation active learning (Gemini Livrable 2) et calibration
         confidence (Gemini Livrable 3). */
      if (caseId) {
        const caseDoc = {
          id: caseId,
          timestamp: entry.timestamp,
          /* Vague 4B — imageHash et userSessionId remontés au top-level
             pour permettre l'agrégation inter-annotateurs (Kappa de Cohen). */
          imageHash: entry.imageHash,
          userSessionId: body.userSessionId || null,
          photoJpeg: correctivePhoto,
          maskPng: correctiveMask,
          coveragePercent: typeof body.coveragePercent === 'number' ? body.coveragePercent : null,
          connectedZonesEstimate: typeof body.connectedZonesEstimate === 'number' ? body.connectedZonesEstimate : null,
          maskMetrics: body.maskMetrics || null,
          shapeAnalysis: body.shapeAnalysis || null,
          feedbackQualityScore,
          trustScore,
          learningWeight,
          feedbackContext: {
            detection: entry.detection,
            identification: entry.identification,
            scoreFeedback: entry.scoreFeedback,
            comment: entry.comment,
            originalAnalysis: context || null,
            lang: entry.lang,
          },
        };
        await kv.set(`lucens:cases:${caseId}`, JSON.stringify(caseDoc), { ex: 60 * 60 * 24 * 365 });
        await kv.lpush('lucens:cases:list', JSON.stringify({
          id: caseId,
          timestamp: entry.timestamp,
          detection: entry.detection,
          identification: entry.identification,
          scoreFeedback: entry.scoreFeedback,
          comment: entry.comment,
          lang: entry.lang,
          feedbackQualityScore,
          trustScore,
          learningWeight,
          iou: body.maskMetrics?.iou || null,
        }));
        await kv.ltrim('lucens:cases:list', 0, 299);

        /* Active learning queue : les cas à haute valeur d'apprentissage
           (quality >= 75 ET trust >= 0.6) sont mis en queue prioritaire
           pour annotation expert dans annotate.html. */
        if (feedbackQualityScore >= 75 && trustScore >= 0.6) {
          await kv.lpush('lucens:cases:review_queue', JSON.stringify({
            caseId,
            timestamp: entry.timestamp,
            learningWeight,
            iou: body.maskMetrics?.iou || null,
            comment: entry.comment,
          }));
          await kv.ltrim('lucens:cases:review_queue', 0, 99);
        }
      }

      /* Index de droit à l'oubli : lucens:forget:<hash> → {feedbackId, caseId, createdAt}
         Permet à /api/lucens-erasure de retrouver les entrées à supprimer
         depuis le seul deleteToken fourni par l'utilisateur.
         TTL 1 an aligné avec la conservation maximale des cas. */
      await kv.set(`lucens:forget:${deleteTokenHash}`, JSON.stringify({
        feedbackId: id,
        caseId: caseId || null,
        createdAt: entry.timestamp,
      }), { ex: 60 * 60 * 24 * 365 });

      stored = true;
    } catch (kvErr) {
      console.log('[LUCENS_FEEDBACK]', JSON.stringify(entry));
    }

    /* Réponse : deleteToken retourné UNE SEULE FOIS en clair.
       Le frontend doit le proposer à l'utilisateur (copie / téléchargement)
       car le serveur ne pourra plus le redonner.
       Le scoring (quality/trust/learning) est aussi exposé pour permettre
       au frontend d'afficher éventuellement un retour à l'utilisateur
       ("Votre feedback a une valeur d'apprentissage élevée, merci"). */
    res.status(200).json({
      ok: true,
      stored,
      overallScore,
      caseId,
      deleteToken,
      scoring: {
        quality: feedbackQualityScore,
        trust: trustScore,
        learningWeight,
      },
      /* Vague 4 — réputation utilisateur + badges nouvellement débloqués.
         Le frontend peut afficher un toast "Bienvenue contributeur qualité !"
         si newBadges contient le badge contributor pour la 1re fois. */
      reputation: userReputation ? {
        count: userReputation.count,
        avgQuality: userReputation.avgQuality,
        avgTrust: userReputation.avgTrust,
        casesWithMask: userReputation.casesWithMask,
      } : null,
      newBadges: entry._newBadges || [],
      privacy: {
        message: "Conservez ce code pour demander la suppression de ce feedback ou du cas associé.",
      },
    });
  } catch (err) {
    console.error('[FEEDBACK_ERROR]', err);
    res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

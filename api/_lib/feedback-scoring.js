/**
 * Vague 2 — Scoring du feedback utilisateur
 *
 * Combine 2 audits :
 *   - computeFeedbackQuality (ChatGPT P1) : 11 critères empiriques pondérés
 *     mesurant la richesse informationnelle du feedback (commentaire, masque,
 *     coverage, cohérence interne entre les 3 questions, contexte, etc.)
 *   - computeTrustScore (Gemini Livrable 6, inspiré Dawid & Skene 1979) :
 *     4 critères qui détectent vandalisme/spam/erreur de compréhension
 *     (cohérence sémantique vs IoU, forme du masque, anomalie HSL, timing)
 *
 * Cascade finale :
 *   effectiveLearningWeight = learningWeightFromQuality(quality) * trustScore
 *
 * → Un feedback à 80/100 quality mais trustScore 0.2 (vandalisme détecté)
 *   ne pèse plus que 0.6 × 0.2 = 0.12 dans la boucle d'apprentissage.
 *   Un feedback à 80/100 + trustScore 1.0 = poids plein 0.6.
 */

const NEGATIVE_DETECTION = new Set(['missed_zones', 'false_positives']);
const NEGATIVE_ID = new Set(['partial', 'incorrect']);
const NEGATIVE_SCORE = new Set(['off', 'wrong']);

/**
 * computeFeedbackQuality (ChatGPT) — 11 critères, retourne 0-100.
 *
 * Inputs riches utilisés :
 *   - longueur commentaire (3 paliers + détection mots vagues)
 *   - présence capture corrective avec consentement
 *   - coverage du masque (sweet spot 0.5-8%, suspect > 60%)
 *   - cohérence interne entre les 3 questions (détection/identification/score)
 *   - contexte fourni (riskScore, detectedTypes, establishmentType, moment)
 *   - timing (submit trop rapide = signal négatif si réponse négative)
 *   - userAgent (bot/crawler)
 */
export function computeFeedbackQuality({
  detection,
  identification,
  scoreFeedback,
  comment,
  correctivePhoto,
  correctiveMask,
  coveragePercent,
  connectedZonesEstimate,
  context,
  consentTraining,
  elapsedMs,
  userAgent,
}) {
  let q = 20;

  const isNegative = NEGATIVE_DETECTION.has(detection)
    || NEGATIVE_ID.has(identification)
    || NEGATIVE_SCORE.has(scoreFeedback);

  const cleanComment = typeof comment === 'string' ? comment.trim() : '';
  const len = cleanComment.length;
  if (len >= 20) q += 10;
  if (len >= 60) q += 10;
  if (len >= 120) q += 8;
  if (hasSpecificWords(cleanComment)) q += 10;
  if (hasVagueOnly(cleanComment)) q -= 12;

  if (correctivePhoto && correctiveMask && consentTraining === true) q += 25;

  const cov = Number(coveragePercent || 0);
  if (cov > 0.05 && cov <= 0.5) q += 5;
  if (cov > 0.5 && cov <= 8) q += 12;
  if (cov > 8 && cov <= 35) q += 8;
  if (cov > 60) q -= 15;

  const zones = Number(connectedZonesEstimate || 0);
  if (zones >= 1 && zones <= 12) q += 5;
  if (zones > 30) q -= 10;

  if (isNegative && !cleanComment && !correctiveMask) q -= 25;

  if (isInternallyCoherent({ detection, identification, scoreFeedback })) q += 10;
  else q -= 15;

  if (context?.riskScore != null) q += 4;
  if (Array.isArray(context?.detectedTypes) && context.detectedTypes.length) q += 4;
  if (context?.establishmentType) q += 4;
  if (context?.moment) q += 4;

  if (typeof elapsedMs === 'number') {
    if (elapsedMs < 1200 && isNegative) q -= 8;
    if (elapsedMs > 8000) q += 4;
  }

  if (/bot|crawler|spider/i.test(String(userAgent || ''))) q -= 50;

  return Math.max(0, Math.min(100, Math.round(q)));
}

/**
 * computeTrustScore (Gemini Livrable 6) — retourne 0.0-1.0.
 *
 * Détecte vandalisme, mauvaise compréhension, "lavage de mains" :
 *   1. Cohérence sémantique : si "all_seen" mais utilisateur peint > 20% surface,
 *      réponses incompatibles avec masque → -0.5
 *   2. Anomalie de forme : rectangle parfait ou contour très fin (entoure
 *      au lieu de peindre) → -0.4
 *   3. Anomalie statistique : coverage > 60% = barbouillage → -0.6
 *   4. Heuristique "lavage de mains" : submit < 5s après modal ouvert → -0.5
 *   5. Anomalie IoU : si user dit "all_seen" mais IoU < 0.05 et coverage > 30%
 *      → -0.7 (vandalisme manifeste)
 */
export function computeTrustScore({
  detection,
  identification,
  scoreFeedback,
  coveragePercent,
  maskMetrics,
  shapeAnalysis,
  elapsedMs,
  correctiveMask,
}) {
  let trust = 1.0;
  const cov = Number(coveragePercent || 0);
  const userTime = Number(elapsedMs || 0);
  const m = maskMetrics || {};
  const s = shapeAnalysis || {};

  /* 1. Cohérence sémantique : utilisateur dit "all_seen" mais a peint
     une grosse zone (FNR élevé suggère qu'il y a des oublis IA majeurs) */
  if (detection === 'all_seen' && m.falseNegativeRatio > 0.20) {
    trust -= 0.5;
  }
  /* Inversement : utilisateur dit "missed_zones" ou "false_positives"
     mais n'a pas peint du tout → incohérence */
  if (NEGATIVE_DETECTION.has(detection) && correctiveMask && cov < 0.05) {
    trust -= 0.3;
  }

  /* 2. Anomalie de forme : user entoure au lieu de peindre */
  if (s.suspectShape === true) {
    trust -= 0.4;
  }

  /* 3. Anomalie statistique : barbouillage (> 60% surface peinte) */
  if (s.suspectVandalism === true || cov > 60) {
    trust -= 0.6;
  }

  /* 4. Lavage de mains : submit < 5s après ouverture modal */
  if (userTime > 0 && userTime < 5000) {
    trust -= 0.5;
  }

  /* 5. Vandalisme manifeste : IoU très faible + coverage anormale */
  if (typeof m.iou === 'number' && m.iou < 0.05 && cov > 30) {
    trust -= 0.7;
  }

  return Math.max(0, Math.min(1, +trust.toFixed(2)));
}

/**
 * learningWeightFromQuality (ChatGPT) — convertit quality 0-100 en poids
 * d'apprentissage discret. Évite de pondérer linéairement (un feedback à 50
 * ne vaut pas la moitié d'un feedback à 100, c'est un autre type d'info). */
export function learningWeightFromQuality(q) {
  if (q < 25) return 0;
  if (q < 50) return 0.25;
  if (q < 75) return 0.6;
  return 1.0;
}

/**
 * effectiveLearningWeight (cascade Vague 2) :
 * Combine quality + trust pour le poids final dans la boucle d'apprentissage.
 * Trust score < 0.3 = feedback ignoré quel que soit le quality score. */
export function effectiveLearningWeight(quality, trust) {
  if (trust < 0.3) return 0;
  return +(learningWeightFromQuality(quality) * trust).toFixed(3);
}

/* ─── Helpers internes ───────────────────────────────────────── */

function hasSpecificWords(text) {
  return /\b(zone|joint|angle|bord|coulure|trace|tache|masque|faux positif|oublié|ATP|écouvillon|détergent|rinçage|biofilm|calcaire|graisse|inox|surface|après nettoyage|reflet|ombre|catégorie|classification|chimique|organique|min[ée]ral)\b/i.test(text);
}

function hasVagueOnly(text) {
  const t = text.toLowerCase().trim();
  return ['non', 'faux', 'pas bon', 'nul', 'bof', 'incorrect', 'wrong', 'bad', 'no', 'mauvais', 'à revoir', 'a revoir'].includes(t);
}

function isInternallyCoherent({ detection, identification, scoreFeedback }) {
  /* Patterns cohérents — feedback exploitable */
  if (detection === 'all_seen' && identification === 'correct' && scoreFeedback === 'correct') return true;
  if (detection === 'missed_zones' && scoreFeedback === 'wrong') return true;
  if (detection === 'false_positives' && scoreFeedback === 'wrong') return true;
  if (identification === 'incorrect' && ['off', 'wrong'].includes(scoreFeedback)) return true;
  if (identification === 'partial' && ['correct', 'off'].includes(scoreFeedback)) return true;

  /* Patterns incohérents — feedback suspect */
  if (detection === 'all_seen' && identification === 'correct' && scoreFeedback === 'wrong') return false;
  if (detection === 'false_positives' && identification === 'correct' && scoreFeedback === 'correct') return false;

  /* Par défaut, on considère cohérent (au bénéfice du doute) */
  return true;
}

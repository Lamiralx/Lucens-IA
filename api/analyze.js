import Anthropic from "@anthropic-ai/sdk";
import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import { applyCors, getClientIp, rateLimit, send429 } from "./_lib/security.js";
import { assignPromptVariant } from "./_lib/ab-testing.js";

/* maxRetries=4 : couvre les vagues de saturation Anthropic jusqu'à ~90s
   (backoff exponentiel intégré au SDK : ~1s, 2s, 4s, 8s)
   timeout 120s : empêche un appel SDK de bloquer indéfiniment si le réseau
   ou Anthropic mettent du temps (avant Phase 2 : pas de timeout = blocage
   possible jusqu'au maxDuration 300s Vercel). */
const client = new Anthropic({ maxRetries: 4, timeout: 120000 });

/* ─── Helpers timeouts (Phase 1 — anti-blocage Vercel KV / Anthropic) ───
   withTimeout : enveloppe une Promise dans un timeout. En cas de dépassement,
   rejette avec une erreur Timeout typée (au lieu de bloquer indéfiniment).
   Sert à éviter qu'un seul appel KV lent ne gèle toute l'analyse. */
function withTimeout(promise, ms, label = 'op') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`[timeout:${label}] dépassé ${ms}ms`);
      err.name = 'TimeoutError';
      err.timeoutMs = ms;
      err.label = label;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* Fallback automatique si Opus reste saturé après les 4 retries du SDK.
   Sonnet 4.6 est généralement moins demandé donc moins sujet aux 529. */
const PRIMARY_MODEL  = "claude-opus-4-7";
const FALLBACK_MODEL = "claude-sonnet-4-6";

/* Statuts qui justifient un fallback : surcharge/indispo Anthropic.
   Pas 4xx (sauf 429) car ce sont des erreurs côté requête, pas serveur. */
const OVERLOAD_STATUSES = new Set([429, 503, 529]);

/* ─── Vague 3 — Few-shot dynamique RAG (Gemini Livrable 5) ─────────
   Sélectionne 2 leçons issues de cas corrigés stockés en KV qui sont
   pertinents pour le contexte de la nouvelle analyse (même type
   d'établissement, même moment). Les leçons sont des descriptions
   textuelles compactes (~120-150 mots chacune) extraites du masque
   correctif de l'utilisateur.

   Budget tokens : 2 leçons × ~150 tokens = +300 tokens par analyse.
   Coût additionnel ~$0.003 par analyse Opus 4.7 (négligeable). */

const FEW_SHOT_MAX = 2;
const FEW_SHOT_CASES_SCAN = 30;

async function fetchRelevantLessons(userContext) {
  if (!userContext || typeof userContext !== 'object') return [];
  try {
    /* Budget global few-shot RAG : 15s max. Au-delà on coupe court et on
       continue l'analyse sans leçons, plutôt que de geler tout l'endpoint. */
    const queueRaw = await withTimeout(
      kv.lrange('lucens:cases:review_queue', 0, FEW_SHOT_CASES_SCAN - 1),
      4000,
      'kv.lrange:review_queue'
    ).catch(err => {
      console.warn('[few-shot] lrange review_queue échoué:', err?.message || err);
      return [];
    });
    const queueItems = (queueRaw || []).map(s => {
      try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
    }).filter(Boolean);
    if (!queueItems.length) return [];

    /* Fetch des cas complets en parallèle, avec timeout global 8s.
       Si UN seul kv.get traîne, on n'attend pas indéfiniment. */
    const fetchAll = Promise.all(queueItems.map(item =>
      withTimeout(
        kv.get(`lucens:cases:${item.caseId}`),
        3000,
        `kv.get:case:${item.caseId}`
      ).then(raw => {
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
      }).catch(err => {
        /* On log au lieu d'avaler en silence — sinon impossible de diagnostiquer
           pourquoi les leçons few-shot disparaissent. */
        if (err?.name === 'TimeoutError') {
          console.warn(`[few-shot] kv.get timeout pour case ${item.caseId}`);
        }
        return null;
      })
    ));
    const docs = await withTimeout(fetchAll, 8000, 'few-shot:fetchAll')
      .catch(err => {
        console.warn('[few-shot] fetchAll échoué:', err?.message || err);
        return [];
      });

    /* Filtrage et scoring par pertinence contextuelle */
    const candidates = [];
    for (const doc of docs) {
      if (!doc) continue;
      if (typeof doc.trustScore === 'number' && doc.trustScore < 0.6) continue;
      const lesson = extractLessonFromCase(doc);
      if (!lesson) continue;
      lesson.relevance = computeContextRelevance(doc, userContext);
      candidates.push(lesson);
    }
    candidates.sort((a, b) => b.relevance - a.relevance);
    return candidates.slice(0, FEW_SHOT_MAX);
  } catch (e) {
    /* On log l'erreur au lieu d'avaler silencieusement : ça permet de voir
       dans les logs Vercel pourquoi les leçons few-shot sont vides. */
    console.warn('[few-shot] fetchRelevantLessons échec:', e?.message || e);
    return [];
  }
}

function extractLessonFromCase(doc) {
  const m = doc.maskMetrics;
  if (!m || typeof m.iou !== 'number') return null;
  const ctx = doc.feedbackContext?.originalAnalysis || {};
  const fb = doc.feedbackContext || {};
  /* Type d'erreur dominant : missed (FNR > FPR) ou false positive (FPR > FNR) */
  const errorType = m.falseNegativeRatio > m.falsePositiveRatio ? 'missed' : 'false_positive';
  const dominantType = (ctx.detectedTypes && ctx.detectedTypes[0]) || 'unknown';
  return {
    establishmentType: ctx.establishmentType || null,
    moment: ctx.moment || null,
    sector: ctx.sector || null,
    errorType,
    dominantType,
    iou: m.iou,
    fpr: m.falsePositiveRatio,
    fnr: m.falseNegativeRatio,
    comment: fb.comment || null,
    detection: fb.detection || null,
    identification: fb.identification || null,
  };
}

function computeContextRelevance(doc, userContext) {
  let score = 0;
  const ctx = doc.feedbackContext?.originalAnalysis || {};
  if (userContext.establishmentType && ctx.establishmentType === userContext.establishmentType) score += 0.5;
  if (userContext.moment && ctx.moment === userContext.moment) score += 0.3;
  if (userContext.role && ctx.role && ctx.role === userContext.role) score += 0.2;
  /* Bonus learning weight élevé = leçon de meilleure qualité */
  score += (Number(doc.learningWeight || 0) * 0.3);
  return +score.toFixed(3);
}

/**
 * computeImageHash : hash SHA-256 tronqué d'un base64 d'image. Sert au
 * bucketing A/B stable (même image = même variante) et à la dédup feedback. */
function computeImageHash(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  try {
    /* V38 fix F-01 : utilisation de createHash importé en haut (node:crypto).
       Le require('crypto') précédent lançait ReferenceError dans un module
       ES — imageHash retournait toujours null, cassant le bucketing A/B
       déterministe et la dédup feedback. */
    return createHash('sha256').update(b64.slice(0, 4096)).digest('hex').slice(0, 16);
  } catch { return null; }
}

/**
 * resolveActiveVariant : si un experiment a status='active', alloue la
 * requête courante à une variante (déterministe par imageHash ou random).
 * Retourne {experimentId, variantId} ou null si aucun experiment actif. */
async function resolveActiveVariant(userContext, imageHash) {
  try {
    /* Liste des expériences avec timeout 3s — si KV mou, on saute l'AB-testing
       plutôt que de bloquer toute l'analyse. */
    const listRaw = await withTimeout(
      kv.lrange('lucens:experiments:list', 0, 9),
      3000,
      'kv.lrange:experiments'
    ).catch(err => {
      console.warn('[AB] lrange experiments échoué:', err?.message || err);
      return [];
    });
    if (!listRaw?.length) return null;

    /* Parse des items et préparation des IDs à fetch */
    const items = listRaw.map(itemRaw => {
      try {
        const it = typeof itemRaw === 'string' ? JSON.parse(itemRaw) : itemRaw;
        return it?.id ? it : null;
      } catch { return null; }
    }).filter(Boolean);
    if (!items.length) return null;

    /* PARALLÉLISATION : tous les kv.get en parallèle au lieu d'un par un.
       Avant : 10 calls séquentiels = 10 × latence_KV (jusqu'à 10s sur KV mou).
       Après : 10 calls en parallèle = max(latences) = ~1s typique.
       Timeout global 5s pour ne jamais bloquer l'endpoint. */
    const fetchAll = Promise.all(items.map(item =>
      withTimeout(
        kv.get(`lucens:experiments:config:${item.id}`),
        2000,
        `kv.get:exp:${item.id}`
      ).then(configRaw => {
        if (!configRaw) return null;
        try {
          const cfg = typeof configRaw === 'string' ? JSON.parse(configRaw) : configRaw;
          return cfg?.status === 'active' ? cfg : null;
        } catch { return null; }
      }).catch(err => {
        if (err?.name === 'TimeoutError') {
          console.warn(`[AB] kv.get timeout pour experiment ${item.id}`);
        }
        return null;
      })
    ));
    const configs = await withTimeout(fetchAll, 5000, 'AB:fetchAll')
      .catch(err => {
        console.warn('[AB] fetchAll échoué:', err?.message || err);
        return [];
      });

    /* Première expérience active gagne (préserve la sémantique d'ordre original) */
    for (const config of configs) {
      if (!config) continue;
      const variantId = assignPromptVariant({
        experimentId: config.id,
        userSessionId: userContext?.userSessionId || null,
        imageHash,
        traffic: config.traffic,
      });
      return { experimentId: config.id, variantId };
    }
  } catch (e) {
    console.warn('[AB] indispo:', e?.message || e);
  }
  return null;
}

function formatLessonsForPrompt(lessons) {
  const intro = "LEÇONS APPRISES D'ANALYSES PRÉCÉDENTES (à intégrer comme corrections de cas similaires) :";
  const bodies = lessons.map((l, i) => {
    const errorDesc = l.errorType === 'missed'
      ? `Lucens IA a RATÉ des zones de contamination (rappel insuffisant, FNR=${(l.fnr * 100).toFixed(0)}%).`
      : `Lucens IA a marqué à tort des zones non-contaminées (sur-détection, FPR=${(l.fpr * 100).toFixed(0)}%).`;
    const ctxDesc = [
      l.establishmentType ? `établissement ${l.establishmentType}` : null,
      l.moment ? `moment ${l.moment}` : null,
      l.sector ? `secteur ${l.sector}` : null,
    ].filter(Boolean).join(', ');
    const commentDesc = l.comment ? ` Commentaire expert : "${l.comment.slice(0, 100)}".` : '';
    return `Leçon ${i + 1} (contexte : ${ctxDesc}, catégorie dominante : ${l.dominantType}, IoU=${l.iou.toFixed(2)}) : ${errorDesc}${commentDesc} Adapte ta lecture en conséquence pour ce contexte similaire.`;
  }).join('\n');
  return intro + '\n' + bodies;
}

const SYSTEM_PROMPT = `RÔLE

Tu es le moteur d'analyse expert de Lucens IA, une application internationale d'interprétation de fluorescence UV-A 365 nm.

Lucens IA analyse des photos de surfaces prises sous lampe UV-A 365 nm afin d'aider l'utilisateur à comprendre ce que le signal fluorescent signifie probablement, puis à produire une recommandation contextualisée.

Le logiciel est utilisé dans plusieurs secteurs : agroalimentaire, restauration, hôtellerie, santé, pharma, industrie, collectivités, espaces publics, nettoyage professionnel, contrôle qualité.

Lucens IA n'est PAS uniquement un outil HACCP alimentaire. Tu DOIS adapter ton raisonnement au secteur, au rôle de la surface et au contexte d'usage.

OBJECTIF CENTRAL

Tu ne dois pas simplement décrire ce qui brille.

❌ Mauvais : "Traces bleu-cyan détectées." / "Signal fluorescent visible."
✅ Bon : "Traces de contact humain accumulées." / "Résidu de détergent probable." / "Biofilm suspect en zone humide."

Tu dois toujours répondre à ces 5 questions :
1. Qu'est-ce que le signal fluorescent correspond probablement à ?
2. Dans quel contexte cette surface est-elle utilisée ?
3. Quel risque ou enjeu hygiénique ce signal peut-il représenter dans ce contexte ?
4. Quelle recommandation concrète et proportionnée doit être donnée ?
5. Qu'est-ce que la fluorescence permet de dire, et qu'est-ce qu'elle ne permet pas de prouver ?

PRINCIPE DE RAISONNEMENT

Signal fluorescent observé + identité probable du dépôt + secteur + type de surface + rôle de la surface + risque de transfert + référentiel pertinent = interprétation + recommandation adaptée.

La recommandation doit être : concrète, actionnable, contextualisée, proportionnée, compréhensible terrain, pédagogique, non exagérée scientifiquement.

RAISONNEMENT PAR RÔLE DE SURFACE

1. SURFACE EN CONTACT DIRECT ALIMENT/PRODUIT (food_contact, product_contact)
   Exemples : plan travail, table découpe, convoyeur, cuve, bac, ustensile, surface interne process.
   Risque : contamination croisée directe.
   Chaîne : surface → aliment/produit → consommateur.
   Reco : re-nettoyer/rincer selon identité probable, ne pas remettre en contact tant que signal persiste, recontrôler sous UV, confirmer ATP/écouvillonnage si nécessaire.

2. SURFACE DE CONTACT MANUEL EN ENV. SENSIBLE (hand_contact)
   Exemples : bouton machine, poignée chambre froide, interrupteur, écran tactile en zone production.
   Risque : transfert indirect par les mains.
   Chaîne : surface → main opérateur → aliment/produit.
   Reco : nettoyer et désinfecter point de contact, intégrer à la routine points de contact fréquents, recontrôler si critique.

3. SURFACE PUBLIQUE/FORTE FRÉQUENCE CONTACT (public_touchpoint)
   Exemples : bouton ascenseur, rampe, poignée publique, borne tactile, terminal paiement.
   Risque : transfert manuporté général.
   Chaîne : surface → main → autre surface/aliment/muqueuse.
   Reco : nettoyer et désinfecter contacts fréquents, insister contours/interstices, rattacher à routine hygiène hôtelière/santé/restauration/collectivité selon secteur.

4. ZONE HUMIDE/JOINT/DRAIN/RECOIN (wet_area)
   Exemples : joint silicone, siphon, drain, angle humide, zone stagnante, pied machine.
   Risque : accumulation organique, biofilm possible.
   Chaîne : humidité + résidus + accès difficile → biofilm potentiel → relargage/transfert.
   Reco : nettoyage mécanique ciblé, désinfection, recontrôle UV, confirmation microbiologique si persistant.

5. PHARMA/CLEANROOM/ZONE CRITIQUE (critical_clean_area)
   Exemples : paillasse pharma, isolateur, environnement maîtrisé, surface proche produit.
   Risque : maîtrise de contamination.
   Chaîne : dépôt non maîtrisé → écart propreté → risque produit/lot.
   Reco : documenter, nettoyer selon procédure validée, recontrôler, escalader si récurrent.

6. ARTEFACT LUMINEUX/LED/ÉCRAN/SUPPORT COLORÉ
   Exemples : bouton lumineux, écran allumé, LED, inox brillant, plastique coloré, verre teinté.
   Risque : fausse interprétation.
   Reco : NE PAS recommander d'action sur LED/halo lumineux comme si contamination. Concentrer la reco sur les traces diffuses réelles.

DISTINCTION INTERPRÉTATION vs RECOMMANDATION

Interprétation = ce que le signal SIGNIFIE probablement.
Ex : "Le signal est compatible avec des traces de contact humain accumulées."

Recommandation = l'action CONCRÈTE à réaliser.
Ex : "Nettoyer et désinfecter les boutons, leurs contours et les zones de contact immédiates."

INTERDIT comme recommandation :
- "Comparer les images." / "Vérifier la cartographie." / "Consulter le rapport." — ce ne sont PAS des actions terrain.

PRISE DE HAUTEUR PÉDAGOGIQUE

Tu DOIS expliquer POURQUOI le signal compte dans le contexte.

INTERDIT : "Bactéries détectées." / "Contamination confirmée." / "Danger microbiologique prouvé."
PRÉFÉRER : "Zone compatible avec une accumulation de résidus de contact humain." / "Risque de transfert indirect." / "Signal à considérer comme anomalie hygiénique selon le contexte." / "Confirmation possible par méthode complémentaire."

RÉFÉRENTIELS SELON CONTEXTE (à mobiliser intelligemment, pas systématiquement)

- Alimentaire : Codex Alimentarius CXC 1-1969, ISO 22000, FSSC 22000, ISO 18593 (prélèvement surface).
- Santé/médical : OMS hygiène des mains, CDC nettoyage environnemental, protocoles IPC.
- Pharma/biotech : EU GMP Annex 1 (si stérile), PIC/S GMP, Contamination Control Strategy.
- Hôtellerie/collectivité : hygiène publique, surfaces fréquemment touchées, routines internes.

FORMAT DE SORTIE

Tu DOIS retourner UNIQUEMENT un JSON valide conforme au schéma fourni. Pas de texte hors JSON.

- result.title : identité PROBABLE du signal, pas sa couleur. Ex : "Traces de contact humain accumulées" et non "Signal bleu-cyan détecté".
- result.interpretation : 1-2 phrases qui répondent à "qu'est-ce que c'est dans CE contexte".
- contextual_reasoning.surface_logic : 1 phrase décrivant le rôle/usage de la surface.
- contextual_reasoning.risk_logic : la CHAÎNE de risque (ex : surface → main → aliment).
- contextual_reasoning.what_fluorescence_suggests : ce que la fluo permet de dire.
- contextual_reasoning.what_fluorescence_does_not_prove : ce qu'elle ne permet PAS de prouver.
- recommendation.primary_action : 1 phrase impérative ACTIONNABLE.
- recommendation.why_this_action : pourquoi cette action est proportionnée.
- recommendation.follow_up : étape suivante (recontrôle UV, confirmation, etc.).
- recommendation.sector_adaptation : adaptation au secteur si pertinent (vide si générique).
- recommendation.confirmation_if_needed : méthode de confirmation suggérée (ATP, écouvillonnage ISO 18593, swab, microbiologie) UNIQUEMENT si pertinent.
- point_of_vigilance.text : 1 phrase d'alerte si artefact lumineux possible ou hypothèse alternative à exclure.
- reference_logic.applicable_frameworks : liste courte des référentiels pertinents pour CE cas (ex : ["Codex CXC 1-1969", "ISO 22000"]). Vide si pas pertinent.
- reference_logic.explanation : 1 phrase expliquant pourquoi ces référentiels s'appliquent.

ZONES VISUELLES (CARTOGRAPHIE — RÈGLES STRICTES)

Le tableau zones[] sert UNIQUEMENT à cartographier les VRAIES FLUORESCENCES visibles sur l'image. Toute zone listée sera coloriée en ROUGE sur la photo pour signaler à l'utilisateur "c'est ici qu'il y a une fluorescence à traiter".

RÈGLE CARDINALE :
- Une zone DOIT correspondre à un signal visiblement plus brillant et plus saturé que le fond, avec une teinte caractéristique de fluorescence (bleu-cyan, vert-jaune, jaune-orange, rouge vif, vert vif, blanc-bleuté brillant).
- Une zone NE DOIT PAS être créée sur un objet, une surface, un reflet, une LED, un écran, une étiquette colorée, un sol coloré ou tout autre élément qui n'émet PAS de fluorescence sous UV-A 365 nm.
- Mieux vaut ZÉRO zone qu'une zone fausse positive. Si la photo ne contient AUCUNE fluorescence réelle → renvoie zones: [].

COUVERTURE DE LA TACHE :
- Chaque bbox DOIT englober TOUTE LA TACHE fluorescente visible, pas juste son centre.
- Si une tache est en croissant, en coulée ou en éclaboussure étendue, la bbox couvre l'enveloppe complète.
- Si plusieurs petites taches sont visiblement liées et continues (même halo, même couleur, même texture, sans rupture nette), utilise UNE seule bbox englobante.
- Si deux taches sont clairement disjointes (espace non-fluo entre elles ou couleurs différentes), utilise DEUX bbox séparées.

CHAMPS PAR ZONE :
- bbox_normalized : {x, y, w, h} en coordonnées 0-1 (couvrant TOUTE la tache)
- label : catégorie courte (organic | chemical | biofilm | pigmented | dust | cosmetic | pest | mixed | unknown)
- intensity : "faible" | "moyenne" | "forte"
- area_pct : pourcentage de surface de l'image
- risk_score : 0-100
- confidence : 0-1 (≥ 0.5 obligatoire — sinon ne PAS lister la zone)
- evidence : phrase explicite décrivant la signature observée (couleur + texture + localisation)
- artifact_rejection : à laisser vide. NE PAS l'utiliser pour lister des artefacts. Les artefacts ne doivent simplement PAS apparaître dans zones[].

LIMITE : 0 à 8 zones. Aucune limite minimale — il vaut mieux retourner 0 zone qu'inventer.

CE QUE TU NE DOIS JAMAIS CARTOGRAPHIER :
- Un objet coloré (plastique, bois, métal, peinture, étiquette, panneau de signalisation)
- Une LED allumée ou un voyant lumineux
- Un écran LCD/OLED en fonctionnement
- Un reflet spéculaire sur inox, verre, plastique brillant
- Un voile UV diffus et uniforme sur toute la surface
- Un substrat coloré qui couvre > 30 % du cadre (sol époxy jaune, dalle PVC verte, peinture sécurité)
- Une ombre, un trou noir, une zone sombre
- Un grain de bois, des fibres de carton, un sac kraft, une texture matière brute

CE QUE TU DOIS CARTOGRAPHIER :
- Toute tache, coulée, smear, éclaboussure, halo, film, dépôt visible qui présente un GLOW propre (plus brillant + plus saturé que le fond local)
- Couvrir l'INTÉGRALITÉ de chaque tache, pas seulement son centre
- Même les taches faibles si elles sont visiblement présentes et nettement distinctes du fond

POINT DE VIGILANCE :
- Si la photo montre principalement un artefact (LED, substrat coloré, reflet), tu DOIS le mentionner dans point_of_vigilance.text pour expliquer pourquoi peu ou pas de zones sont listées.
- Format : "Attention : [type d'artefact détecté] — ce signal n'est PAS une fluorescence et a été écarté de la cartographie."

═══════════════════════════════════════════════════════════════
🧪 BIBLIOTHÈQUE DE SIGNATURES FLUORESCENTES (UV-A 365 nm)
═══════════════════════════════════════════════════════════════

Tu DOIS exploiter cette bibliothèque pour identifier précisément les signaux observés. Pour CHAQUE zone fluo, mentionne le fluorophore probable dans evidence.

A. SIGNATURES BIOLOGIQUES (résidus organiques frais)
  • NADH/NADPH (460 nm, BLEU profond) → protéines fraîches, viande, fluides bio
  • Tryptophane (350 nm + halo violet) → marqueur protéique général
  • FAD/Riboflavine vit. B2 (525 nm, JAUNE-VERT vif) → LAIT, ŒUFS, levure, fromages
  • Hyaluronate/mucus (470 nm, bleu-cyan) → sécrétions muqueuses

B. SIGNATURES PIGMENTAIRES
  • Porphyrines/Hème (635 nm, ROUGE VIF) → SANG, urine mammifères → CRITIQUE
  • Acide urique urochrome (405-440 nm, JAUNE-ORANGE brillant) → URINE rongeur → CRITIQUE
  • Chlorophylle (685 nm, rouge sombre) → résidu végétal
  • Lycopène (590 nm, orange-rouge) → tomate, fruits rouges

C. SIGNATURES CHIMIQUES
  • Stilbenes/azurants optiques (430 nm, BLEU-CYAN intense) → DÉTERGENT (lessive, savon pro) → défaut de rinçage
  • Huiles minérales/HAP (480 nm, bleu-vert pâle) → LUBRIFIANT machine → CRITIQUE en agro
  • Filtres UV cosmétiques (440 nm, blanc-bleuté) → traces opérateurs mains/peau
  • Tétracyclines/sulfamides (450-490 nm, jaune-vert pâle) → ANTIBIOTIQUE vétérinaire → CRITIQUE
  • Aflatoxines (425 nm, BLEU-VIOLET fluo) → MYCOTOXINES Aspergillus → CRITIQUE cancérigène
  • Ochratoxine A (467 nm, vert-blanc) → mycotoxine fungique vins/cafés/céréales

D. SIGNATURES MICROBIENNES
  • Pyoverdines Pseudomonas spp. (510-520 nm, VERT-JAUNE diffus) → BIOFILM établi → ÉLEVÉ
  • Pyocyanine P. aeruginosa (460+690 nm, bleu-vert ambigu) → biofilm avancé

E. SIGNATURES PARASITAIRES
  • Urine de rongeur (acide urique + porphyrines, JAUNE-ORANGE à ROUGE BRILLANT) → CRITIQUE
  • Frass d'insectes (460-500 nm, bleu-vert ponctuel) → ÉLEVÉ
  • Soie d'araignée (410-440 nm, bleu-violet) → présence arachnides

═══════════════════════════════════════════════════════════════
📊 CALIBRATION DU SCORE CONTEXTUEL HACCP (RÈGLE CRITIQUE)
═══════════════════════════════════════════════════════════════

Le score DOIT prendre en compte le SECTEUR + le RÔLE DE LA SURFACE + l'IDENTITÉ du résidu. Mêmes signaux → scores différents selon contexte.

MATRICE MINIMALE DE SCORE (plancher minimum à respecter) :

| Identité résidu       | food_contact / product_contact | hand_contact / public_touchpoint | wet_area      | critical_clean_area | non_product / low_risk |
|-----------------------|--------------------------------|----------------------------------|---------------|---------------------|------------------------|
| Détergent rincé incompl. | min 35-55 (Moyen)            | min 28-40 (Moyen)                | min 30-45 (Moyen) | min 50-65 (Élevé) | min 15-25 (Faible)   |
| Résidu organique       | min 50-70 (Moyen-Élevé)        | min 35-50 (Moyen)                | min 50-70 (Élevé) | min 60-80 (Élevé) | min 20-30 (Faible)   |
| Biofilm Pseudomonas    | min 65-85 (Élevé)              | min 55-75 (Élevé)                | min 70-90 (Élevé) | min 80-95 (Élevé) | min 40-55 (Moyen)    |
| Sang / porphyrines     | min 75-95 (Élevé/CRITIQUE)     | min 65-85 (Élevé)                | min 70-90 (Élevé) | min 85-99 (CRITIQUE) | min 45-60 (Moyen)  |
| Urine rongeur          | min 90-99 (CRITIQUE)           | min 85-95 (CRITIQUE)             | min 88-95 (CRITIQUE) | min 95-99 (CRITIQUE) | min 70-85 (Élevé) |
| Huile minérale         | min 85-95 (CRITIQUE en agro)   | min 50-70 (Élevé)                | min 50-70 (Élevé) | min 90-99 (CRITIQUE) | min 25-40 (Moyen)  |
| Mycotoxine aflatoxine  | min 95-99 (CRITIQUE)           | min 80-90 (Élevé)                | min 85-95 (Élevé) | min 95-99 (CRITIQUE) | min 60-75 (Élevé)  |
| Antibiotique           | min 80-95 (CRITIQUE)           | min 50-70 (Élevé)                | min 60-75 (Élevé) | min 90-99 (CRITIQUE) | min 30-45 (Moyen)  |
| Cosmétique             | min 35-50 (Moyen)              | min 20-30 (Faible)               | min 25-35 (Moyen) | min 50-65 (Élevé)  | min 10-20 (Faible)  |
| Poussière/fibres       | min 20-35 (Faible)             | min 15-25 (Faible)               | min 25-40 (Moyen) | min 40-55 (Moyen)  | min 5-15 (Faible)   |
| Inconnu fluo           | min 40-60 (Moyen)              | min 25-40 (Moyen)                | min 35-55 (Moyen) | min 55-75 (Élevé)  | min 15-30 (Faible)  |

INTERDIT : score < 25 quand une vraie fluorescence est détectée en food_contact / wet_area / critical_clean_area CONFIRMÉ par l'utilisateur. Si tu identifies un signal fluo en cuisine de restauration MAIS sans confirmation explicite du rôle de la surface (food_contact non certain), reste sur un score MOYEN (35-55) ET mentionne dans hygiene_note que le score peut monter ou descendre selon le rôle réel de la surface, qu'il appartient à l'utilisateur de préciser.

PRINCIPE DE PRÉCAUTION ANTI-SPÉCULATION :
Le contexte d'analyse fournit "sector" (ex: food_service) mais pas toujours "surface_role". Si surface_role n'est pas explicitement food_contact / product_contact / critical_clean_area, tu NE DOIS PAS présumer que cette surface particulière est en contact alimentaire. Reste sur le plancher générique "Moyen" et propose à l'utilisateur d'ajuster selon le vrai usage. Ne JAMAIS forcer un score Élevé sur une hypothèse non vérifiable.

Modulateurs (additifs au plancher) :
- Surface > 5% de l'image : +10
- Plusieurs zones distinctes : +5 par zone (max +20)
- Photo très nette : -5 (confidence haute, on peut être précis)
- Photo dégradée : +5 (par prudence)

EXEMPLES CONCRETS :
• Trace cyan détergent en cuisine sur plan de travail food_contact → score 45-55 (Moyen), pas 6.
• Halo vert biofilm sur joint de cuve en agro wet_area → score 75-85 (Élevé).
• Tache jaune-orange sur sol en zone de stockage → score 70-85 (Élevé urine rongeur potentielle).

═══════════════════════════════════════════════════════════════
🚫 INTERDICTION ABSOLUE — ZONES FLUO TUÉES
═══════════════════════════════════════════════════════════════

Si une fluorescence est VISIBLEMENT présente sur l'image (couleur saturée, halo, glow), tu DOIS la lister dans zones[] même si tu ne peux pas l'identifier précisément. Utilise alors label "unknown" avec confidence "low" + evidence décrivant ce que tu vois. JAMAIS de zone fluo visible ignorée.

CHAMPS LEGACY OBLIGATOIRES (alimentent l'UI hero + observations + distribution)

En PLUS du raisonnement contextuel V21, tu DOIS remplir ces champs UI legacy :

- **score** : entier 0-100. Niveau de risque global de la scène. CALIBRÉ selon matrice ci-dessus (jamais < 25 si fluo réelle en zone sensible). 0-27 = Faible, 28-62 = Moyen, 63-100 = Élevé.
- **riskLevel** : "Faible" | "Moyen" | "Élevé" (cohérent avec score).
- **coveragePercent** : nombre 0-100. % de la surface inspectée couverte par fluorescence.
- **zoneCount** : entier. Nombre de zones distinctes détectées (≥ length de zones[]).
- **analyzability_score** : 0-100. Fiabilité de l'analyse (qualité photo, contraste, netteté).

- **probabilities** : array de { id, probability 0-100 } — distribution par CATÉGORIE. id ∈ {organic, fatty, chemical, mineral, biofilm, dust, pigmented, cosmetic, adhesive, pest, mixed, unknown}. Somme = 100. Min 2 catégories, max 6.

- **observations** : array de { tag, body, confidence: "high"|"medium"|"low" }. Rédige 5-8 observations FACTUELLES (2-3 phrases chacune, vocabulaire technique précis MAIS strictement basé sur ce qui est VISIBLE).

  RÈGLE ABSOLUE ANTI-SPÉCULATION (V29) :
  Tu ne dois JAMAIS affirmer un fait que tu ne peux pas vérifier visuellement dans l'image.
  - INTERDIT : "Plan de travail en céramique" / "stratifié haute pression" / "HDPE alimentaire" — tu ne peux PAS connaître le matériau précis depuis une photo UV.
  - INTERDIT : "au-dessus se trouve un sécheur" / "poste de préparation" / "zone de découpe" — tu ne vois pas l'environnement complet.
  - INTERDIT : "surface en contact alimentaire" — même si le secteur est restauration, tu ne sais PAS si cette surface particulière touche les aliments. C'est l'UTILISATEUR qui le sait.
  - AUTORISÉ : "Plan de travail à surface lisse, effet marbre" (description visuelle factuelle).
  - AUTORISÉ : "Surface présentant un signal fluorescent cyan dans le coin supérieur gauche" (factuel).
  - AUTORISÉ : "Le secteur restauration suggère qu'il s'agit possiblement d'une surface alimentaire — à confirmer par l'utilisateur selon l'usage réel" (qualifié, laisse à l'utilisateur).

  Inclure :
  - tag "surface_inspected" : description VISUELLE factuelle de la surface (couleur, texture apparente, présence de joints/relief) + état apparent (humide/sec si visible). Ex: "Surface plane à finition lisse et veinage clair (effet marbre), apparence sèche, joints non visibles dans le cadre."
  - tag "fluorescence_detected" : pour CHAQUE zone fluo, signature observée (couleur + localisation + étendue approximative) + fluorophore COMPATIBLE de la bibliothèque (jamais affirmé). Ex: "Halo cyan-bleu d'environ 8 cm² au centre-droit, signature compatible avec des azurants optiques (résidu de détergent)."
  - tag "ambient_uv" : niveau voile UV ambiant + cohérence éclairage 365 nm. Factuel.
  - tag "artifacts_excluded" : si LEDs/écrans/reflets détectés → décrire et écarter. Factuel.
  - tag "context_clue" : indices visuels SECONDAIRES OBSERVÉS uniquement (forme de la surface, présence d'objet visible). Si rien de pertinent visible → omettre ce tag.
  - tag "hygiene_note" : note conditionnée à l'usage. Format : "SI cette surface est en contact direct avec un aliment, alors [implication]. SINON, [implication moindre]. À ajuster selon le rôle réel de la surface."
  - tag "scoring_rationale" : explication du score en mentionnant l'incertitude sur le rôle de surface. Ex: "Score 45 (Moyen) — plancher minimal pour résidu de détergent. Si confirmation que la surface est food_contact, le score remonte à 55-65 ; si surface non alimentaire, il descend à 25-35. L'utilisateur ajuste selon l'usage réel."
  - tag "user_to_confirm" : OBLIGATOIRE — liste 1-2 points que l'utilisateur DOIT confirmer pour préciser l'analyse (ex: "Cette surface est-elle en contact direct avec un aliment ? Cette zone a-t-elle été nettoyée récemment ?"). Crucial pour rester factuel.

- **image_quality** : { usable (boolean), warning (string vide ou alerte courte), limitations (array de strings) }

- **differential_diagnosis** : array de 2-4 hypothèses alternatives. Pour chaque : { hypothesis (code), label_human ("Résidu détergent" etc.), probability 0-1, urgency "low"|"medium"|"high"|"critical", reasoning (1 phrase), priority_test (boolean) }

- **recommended_validation** : array de strings (ATP, écouvillonnage ISO 18593, swab, etc.) — méthodes de validation suggérées.

- **missing_context** : array de strings — infos manquantes qui amélioreraient l'analyse si l'utilisateur les précisait.

RÈGLE DE COHÉRENCE FINALE

Avant de produire le JSON, vérifie :
1. result.title nomme l'IDENTITÉ probable (pas la couleur)
2. recommendation.primary_action est une ACTION CONCRÈTE à l'impératif
3. contextual_reasoning.risk_logic décrit la CHAÎNE complète
4. La recommandation est PROPORTIONNÉE au risque
5. Tu n'as PAS affirmé une contamination microbiologique sans confirmation
6. zones[] est rempli pour la cartographie visuelle
7. score + riskLevel + observations + probabilities + differential_diagnosis sont remplis pour l'UI

SORTIE OBLIGATOIRE : JSON strict conforme au schéma fourni. N'ajoute aucun texte hors JSON.`;

/* Nouveau SCHEMA — Phase 3 audit
   Force le raisonnement structuré via un bloc analysis/global_assessment/reasoning_summary.
   Compatible json_schema strict (pas de texte libre hors JSON). */
const LABEL_ENUM = ["organic", "fatty", "chemical", "mineral", "biofilm", "dust", "pigmented", "cosmetic", "adhesive", "pest", "mixed", "unknown"];

const SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string" },
    /* V21 — analyzable : false si photo hors scope inspection UV-A 365 nm */
    analyzable: { type: "boolean" },
    reason_not_analyzable: { type: "string" },

    /* V21 — Contexte utilisateur récupéré (echo) */
    input_context: {
      type: "object",
      properties: {
        sector:             { type: "string" },
        surface_type:       { type: "string" },
        surface_role:       { type: "string" },
        analysis_objective: { type: "string" },
      },
      required: ["sector", "surface_type", "surface_role", "analysis_objective"],
      additionalProperties: false,
    },

    /* V21 — Résultat principal : identité probable du signal */
    result: {
      type: "object",
      properties: {
        title:            { type: "string" },
        probable_identity:{ type: "string" },
        signal_nature:    { type: "string" },
        confidence_label: { type: "string" },
        interpretation:   { type: "string" },
      },
      required: ["title", "probable_identity", "signal_nature", "confidence_label", "interpretation"],
      additionalProperties: false,
    },

    /* V21 — Raisonnement contextuel */
    contextual_reasoning: {
      type: "object",
      properties: {
        surface_logic:                 { type: "string" },
        risk_logic:                    { type: "string" },
        what_fluorescence_suggests:    { type: "string" },
        what_fluorescence_does_not_prove: { type: "string" },
      },
      required: ["surface_logic", "risk_logic", "what_fluorescence_suggests", "what_fluorescence_does_not_prove"],
      additionalProperties: false,
    },

    /* V21 — Recommandation actionnable */
    recommendation: {
      type: "object",
      properties: {
        title:              { type: "string" },
        primary_action:     { type: "string" },
        why_this_action:    { type: "string" },
        follow_up:          { type: "string" },
        sector_adaptation:  { type: "string" },
        confirmation_if_needed: { type: "string" },
      },
      required: ["title", "primary_action", "why_this_action", "follow_up", "sector_adaptation", "confirmation_if_needed"],
      additionalProperties: false,
    },

    /* V21 — Point de vigilance */
    point_of_vigilance: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
      additionalProperties: false,
    },

    /* V21 — Référentiels applicables au cas */
    reference_logic: {
      type: "object",
      properties: {
        applicable_frameworks: { type: "array", items: { type: "string" } },
        explanation:           { type: "string" },
      },
      required: ["applicable_frameworks", "explanation"],
      additionalProperties: false,
    },

    /* V21 — Métadonnées rapport PDF */
    report: {
      type: "object",
      properties: {
        include_original_image:  { type: "boolean" },
        include_annotated_image: { type: "boolean" },
        summary_for_pdf:         { type: "string" },
      },
      required: ["include_original_image", "include_annotated_image", "summary_for_pdf"],
      additionalProperties: false,
    },

    /* V21 — Zones[] conservées pour cartographie visuelle.
       Le rendu UI principal s'appuie sur result + recommendation,
       mais zones[] reste utile pour annoter l'image. */
    zones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:                { type: "string" },
          label:             { type: "string" },
          intensity:         { type: "string" },
          area_pct:          { type: "number" },
          risk_score:        { type: "integer" },
          confidence:        { type: "number" },
          bbox_normalized: {
            type: "object",
            properties: {
              x: { type: "number" }, y: { type: "number" },
              w: { type: "number" }, h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
            additionalProperties: false,
          },
          evidence:          { type: "string" },
          artifact_rejection:{ type: "string" },
        },
        required: ["id", "label", "bbox_normalized", "area_pct", "intensity", "evidence"],
        additionalProperties: false,
      },
    },

    /* V24 — Restauration des champs LEGACY supprimés par erreur en V21.
       Ces champs alimentent l'UI hero (score, risque) + observations +
       distribution probabilité + différentiel + qualité photo. Sans eux,
       toute la page d'analyse était vide. */
    score:               { type: "integer" },
    riskLevel:           { type: "string" },
    coveragePercent:     { type: "number" },
    zoneCount:           { type: "integer" },
    analyzability_score: { type: "integer" },

    /* V24.1 — Champs UI legacy en format ALLÉGÉ pour rester sous le seuil
       de grammaire compilée Anthropic. Pas d'additionalProperties imbriqués,
       pas de required sur items array (Claude libre de remplir ce qu'il peut). */

    /* Distribution par catégorie : array de "id:probability" en format texte */
    probabilities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:          { type: "string" },
          probability: { type: "number" },
        },
      },
    },

    /* Observations rédigées par l'IA */
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tag:        { type: "string" },
          body:       { type: "string" },
          confidence: { type: "string" },
        },
      },
    },

    /* Qualité photo */
    image_quality: {
      type: "object",
      properties: {
        usable:      { type: "boolean" },
        warning:     { type: "string" },
        limitations: { type: "array", items: { type: "string" } },
      },
    },

    /* Différentiel diagnostique */
    differential_diagnosis: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hypothesis:    { type: "string" },
          label_human:   { type: "string" },
          probability:   { type: "number" },
          urgency:       { type: "string" },
          reasoning:     { type: "string" },
          priority_test: { type: "boolean" },
        },
      },
    },

    /* Tests de validation recommandés */
    recommended_validation: { type: "array", items: { type: "string" } },

    /* Contexte manquant */
    missing_context: { type: "array", items: { type: "string" } },
  },
  required: ["language", "analyzable", "result", "contextual_reasoning", "recommendation", "point_of_vigilance", "reference_logic", "report", "zones",
             "score", "riskLevel", "observations"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  /* CORS restreint à la whitelist (lieu de l'app), au lieu d'un wildcard "*" */
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server not configured: missing ANTHROPIC_API_KEY" });
  }

  /* Rate limit anti-cost-attack : 30 analyses / IP / heure.
     Suffisant pour un audit HACCP intensif (15 analyses x 2 = 30) sans gêner
     les utilisateurs légitimes, mais bloque toute attaque massive. */
  const ip = getClientIp(req);
  const rl = await rateLimit({ scope: "analyze", ip, limit: 30, windowSec: 3600 });
  if (!rl.ok) return send429(res, rl.retryAfter);

  try {
    const { image, mediaType, detectedZones, zoneCrops, lang, userContext, liveHints } = req.body || {};
    if (!image) return res.status(400).json({ error: "Missing 'image' (base64 string)" });
    if (!mediaType) return res.status(400).json({ error: "Missing 'mediaType' (e.g. image/jpeg)" });
    /* Validation taille image : refuse les payloads anormalement gros qui
       gonfleraient artificiellement le coût Anthropic. 8 MB de base64 ≈ 6 MB image
       décodée — largement suffisant pour une photo HACCP haute qualité. */
    if (typeof image === "string" && image.length > 8_000_000) {
      return res.status(413).json({ error: "Image trop volumineuse. Taille max : 6 Mo." });
    }
    /* Validation format MIME : seulement les types image courants */
    if (!/^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(mediaType)) {
      return res.status(415).json({ error: "Format d'image non supporté." });
    }

    const userLang = ['fr', 'en', 'es', 'de'].includes(lang) ? lang : 'fr';
    const langName = { fr: 'français', en: 'English', es: 'español', de: 'Deutsch' }[userLang];

    /* Option C — TOUJOURS le schéma libre (SCHEMA).
       L'IA détecte ses propres zones et calcule ses propres pourcentages
       à partir d'un raisonnement visuel global d'expert.
       Les zones heuristiques sont passées en HINTS uniquement (jamais en contraintes). */
    const hybridMode = false;
    const schemaToUse = SCHEMA;

    /* Crops par zone — toujours utiles comme grounding visuel pour les zones suggérées,
       mais l'IA peut détecter d'autres zones que celles-ci. */
    const hasZoneCrops = Array.isArray(detectedZones) && detectedZones.length > 0
      && Array.isArray(zoneCrops)
      && zoneCrops.length === detectedZones.length
      && zoneCrops.every(c => typeof c === 'string' && c.length > 0);

    /* USER PROMPT — Phase 3 audit : concis, hiérarchisé, avec few-shot */
    const hasHints = Array.isArray(detectedZones) && detectedZones.length > 0;
    const hintsLine = hasHints
      ? `\nHints heuristiques (à valider, pas une contrainte) : ${detectedZones.length} zones-candidates fournies${hasZoneCrops ? ' avec crops 384×384 dans l\'ordre' : ''}. L'heuristique HSL rate souvent les grandes zones denses et invente des zones sur le voile UV ; utilise ton jugement visuel global.\n`
      : '';

    /* ─── Live View hints (V7) ─────────────────────────────────────────
       Si la capture vient du mode Live View UV-A, on informe Claude :
       1. Image volontairement éclaircie (scène UV sombre) → ne pas pénaliser
          la qualité pour luminosité ;
       2. Pré-scan HSV temps réel → zones candidates en coordonnées
          normalisées (indice, pas contrainte) ;
       3. Calibration utilisateur éventuelle → registre chromatique cible. */
    let liveHintsLine = '';
    if (liveHints && typeof liveHints === 'object' && liveHints.capturedFromLive) {
      const parts = ['CONTEXTE DE CAPTURE — mode Live View UV-A 365 nm :'];
      if (typeof liveHints.sceneLuminance === 'number') {
        parts.push(`La scène d'origine est sombre (luminance moyenne ${liveHints.sceneLuminance}/255), ce qui est NORMAL et attendu sous éclairage UV-A.`);
      }
      if (liveHints.boostApplied && typeof liveHints.boostApplied.brightness === 'number') {
        parts.push(`L'image a été éclaircie automatiquement à la capture (gain luminosité ×${liveHints.boostApplied.brightness.toFixed(2)}) pour rester exploitable. NE PÉNALISE PAS la qualité (image_quality.usable) pour un motif de faible luminosité : l'éclaircissement est volontaire et l'image est exploitable.`);
      }
      if (liveHints.multiFrame) {
        parts.push(`L'image est la frame la plus nette sélectionnée parmi ${liveHints.multiFrame} captures (anti-flou de bougé). C'est une frame vidéo : elle peut présenter un LÉGER adoucissement normal du flux caméra. NE BLOQUE PAS l'analyse pour un flou léger (image_quality.usable doit rester true sauf flou EXTRÊME rendant les surfaces non identifiables). Analyse au mieux les zones visibles.`);
      }
      const lvZones = Array.isArray(liveHints.zones) ? liveHints.zones : [];
      if (lvZones.length > 0) {
        const zoneDesc = lvZones.slice(0, 12).map((z, i) => {
          const cx = (Number(z.x) + Number(z.w) / 2);
          const cy = (Number(z.y) + Number(z.h) / 2);
          /* Texture : indice morphologique pour aider la catégorisation */
          let texTag = '';
          if (typeof z.texture === 'number') {
            texTag = z.texture > 55 ? ' texture structurée'
                   : z.texture < 25 ? ' texture lisse'
                   : ' texture modérée';
          }
          return `#${i + 1} centre≈(${cx.toFixed(2)},${cy.toFixed(2)})${texTag}`;
        }).join(' ; ');
        parts.push(`Un pré-scan optique HSV temps réel a repéré ${lvZones.length} zone(s) fluorescente(s) candidate(s) (coordonnées normalisées 0-1) : ${zoneDesc}. Traite-les comme INDICE de localisation, valide chacune par ton jugement visuel — le pré-scan rate parfois les signaux faibles et peut sur-détecter sur reflets. INDICE TEXTURE : une zone "structurée" oriente vers biofilm / sang séché / dépôt cristallin ; une zone "lisse" oriente vers film organique étalé / résidu liquide / voile — utilise cet indice morphologique pour affiner la catégorisation, sans en faire une règle absolue.`);
      }
      if (liveHints.calibration && liveHints.calibration.calibrated) {
        parts.push(`Le pré-scan a été CALIBRÉ sur une carte de référence (${liveHints.calibration.signatures || 0} signatures fluorophores réelles, balance des blancs corrigée) : les zones candidates sont fiables, le substrat coloré et les sources lumineuses ont été écartés par matching de signatures.`);
      }
      liveHintsLine = '\n' + parts.join(' ') + '\n';
    }

    /* Hash anonyme de l'image pour bucketing A/B stable */
    const imageHash = computeImageHash(image);

    /* Sprint 1 — Contexte utilisateur transmis depuis localStorage.
       Calibre la criticité de l'analyse selon le type d'établissement,
       le rôle et le moment de la photo.
       SÉCURITÉ : tous les champs textuels qui finissent dans le prompt Claude
       doivent être whitelistés strictement pour éviter l'injection de prompt.
       Aucun champ "free-form" envoyé par le client ne doit être concaténé brut. */
    let userContextLine = '';
    let activeVariantInfo = null;
    if (userContext && typeof userContext === 'object' && userContext.establishmentType) {
      const typeLabels = {
        restauration: "restauration et hôtellerie (restaurant, cantine, hôtel, snack)",
        agro: "production agroalimentaire (usine de transformation, conditionnement, abattoir, laiterie)",
        distrib: "distribution alimentaire (supermarché, marché, entrepôt froid, transport réfrigéré)",
        medical: "santé et soin (hôpital, EHPAD, clinique, vétérinaire, cabinet médical)",
        pharma: "pharma et laboratoires (production pharmaceutique, salle blanche, cosmétique)",
        industrial: "industrie et atelier (atelier mécanique, traitement de surface, peinture, métallurgie)",
        residential: "habitat résidentiel (appartement, maison, copropriété)",
        erp: "ERP et lieux publics (école, transport, piscine, vestiaire, musée)",
      };
      const momentLabels = {
        before_cleaning: "AVANT nettoyage (contrôle initial). Une contamination étendue est attendue à ce stade — le but est de mesurer la charge présente avant intervention. Ne pas pénaliser le score pour la présence de salissures.",
        after_cleaning: "APRÈS nettoyage (validation d'efficacité). À ce stade la surface devrait être propre. Toute fluorescence résiduelle indique un défaut du protocole de nettoyage. Pénalise sévèrement le score pour toute contamination résiduelle.",
        routine_check: "contrôle de routine. Vigilance normale, ni laxiste ni alarmiste.",
        incident: "suite à un incident ou alerte signalée. Lecture renforcée, attention à tout signal de risque.",
      };
      /* SÉCURITÉ : whitelist stricte. Si la valeur n'est pas dans typeLabels,
         on ignore le contexte entièrement (anti prompt-injection). */
      const typeFr = typeLabels[userContext.establishmentType];
      if (!typeFr) {
        /* Type non reconnu : on n'injecte rien dans le prompt. */
        userContextLine = '';
      }
      const momentFr = (typeFr && userContext.moment && momentLabels[userContext.moment])
        ? ` Moment du cliché : ${momentLabels[userContext.moment]}`
        : '';
      /* Profil utilisateur dynamique : rôle.
         RÈGLE D'OR : ne JAMAIS dicter à l'utilisateur comment faire son métier.
         Le rôle oriente UNIQUEMENT le ton, la priorité et la hiérarchie de
         présentation. Reste impartial, synthétique, factuel. */
      const roleLabels = {
        responsable: "Lecture orientée pilotage : conséquence système, traçabilité, dimension décisionnelle. Synthétique, impartiale.",
        operationnel: "Lecture orientée terrain : zones concernées, urgence relative. Synthétique, impartiale.",
        auditeur: "Lecture orientée conformité : écart factuel, position normative. Synthétique, impartiale, ton formel.",
        formateur: "Lecture orientée transfert pédagogique : clarté de la signature, lisibilité du raisonnement. Synthétique, impartiale.",
      };
      const roleFr = userContext.role && roleLabels[userContext.role]
        ? ` Profil utilisateur : ${roleLabels[userContext.role]}`
        : '';
      /* Injection des métriques capteur (Commit 3) : si purple blowout
         détecté côté client, l'IA en tient compte pour réduire la confiance
         couleur et lever le drapeau sensor_color_drift. */
      let sensorWarning = '';
      const sm = userContext.sensorMetrics;
      if (sm && typeof sm.purpleLikelihood === 'number' && sm.purpleLikelihood >= 0.6) {
        sensorWarning = `\nALERTE CAPTEUR : Dérive colorimétrique CMOS détectée côté client (purple blowout likelihood ${sm.purpleLikelihood.toFixed(2)}, dominance G/(R+B) ${sm.purpleDominance?.toFixed?.(2) || '?'}). La balance des blancs auto du smartphone compense le violet en poussant les verts. Ne classe PAS chemical/biofilm sur la base d'une teinte verte ambiguë. Marque sensor_color_drift et color_unreliable dans les uncertainty_sources des zones concernées. Plafonne la confidence couleur à 0.60 sur ces zones.`;
      }
      if (typeFr) {
        /* V49 P5 — Seuil de confidence adaptatif par contexte HACCP :
           en surface critique (food_contact, wet_area, critical_clean_area)
           on accepte les zones dès 0.55 pour ne PAS rater une contamination
           dans une zone à haut risque sanitaire. En contexte moins critique
           (erp, residential, low_risk) on monte à 0.65 pour éviter de
           sur-détecter sur des matériaux inertes. */
        userContextLine = `\nCONTEXTE UTILISATEUR (à intégrer dans la criticité) : établissement de type ${typeFr}.${momentFr}${roleFr} Adapte le niveau de risque, la lecture procédurale et la position normative HACCP à ce cadre. RÈGLE IMPÉRATIVE : ne JAMAIS dicter à l'utilisateur comment faire son métier ; le rôle indique seulement le ton et la priorité de présentation. Reste impartial, synthétique, factuel. Ne demande pas le type d'établissement ni le moment dans missing_context puisqu'ils sont fournis.\n\nSEUIL DE CONFIDENCE ADAPTATIF : surfaces critiques (food_contact, wet_area, critical_clean_area) → liste les zones dès confidence ≥ 0.55 pour priorité sanitaire. Surfaces moins critiques (erp, residential, low_risk) → ne liste que les zones avec confidence ≥ 0.65 pour éviter la sur-détection.${sensorWarning}\n`;
      }
    }

    /* Vague 3 — Few-shot dynamique RAG (Gemini Livrable 5) :
       Sélectionne 2 leçons issues de cas corrigés similaires au contexte
       de l'analyse actuelle. Injecté dans le prompt après le contexte utilisateur.
       Best-effort : si KV indispo ou pas de cas pertinents, ne bloque pas l'analyse. */
    let dynamicLessons = '';
    try {
      const lessons = await fetchRelevantLessons(userContext);
      if (lessons && lessons.length) {
        dynamicLessons = '\n' + formatLessonsForPrompt(lessons) + '\n';
      }
    } catch (e) {
      console.warn('[FEW_SHOT] indisponible:', e?.message || e);
    }
    userContextLine += dynamicLessons;

    /* Vague 3 — A/B testing variant assignment (ChatGPT Mission 5).
       Si un experiment actif existe, on assigne déterministiquement la
       requête courante à une variante. Le variantId est retourné côté client
       et tracké dans le feedback pour mesurer l'effet sur la précision. */
    activeVariantInfo = await resolveActiveVariant(userContext, imageHash);

    const userText = `Langue de sortie : ${langName} (${userLang}). Réponds uniquement dans cette langue.

Analyse l'image globale UV-A 365 nm et les crops candidats fournis.
${hintsLine}${liveHintsLine}${userContextLine}
Procédure obligatoire :
1. Inspecte d'abord l'image globale : surface réellement visible, matériaux, zones hors champ, qualité image.
2. Estime le fond UV normal : voile bleu/violet, reflets, zones surexposées, hot pixels, flou.
3. Détecte les fluorescences suspectes réelles : zones localisées ou texturées dépassant le fond.
4. Estime l'aire contaminée totale sur l'image globale, indépendamment du nombre de crops.
5. Valide ou rejette chaque crop candidat, puis fusionne les doublons.
6. Classe chaque zone parmi : organic, fatty, chemical, mineral, biofilm, dust, pigmented, cosmetic, adhesive, pest, mixed, unknown.
7. Calcule le score 0-100.
8. Rédige 1 à 5 observations expertes, uniquement si elles apportent une information réelle. Ne force jamais un quota.

Critères de rejet :
- Rejette un signal seulement s'il est principalement uniforme, géométrique, spéculaire, ou identique au fond UV.
- Ne rejette pas une zone saturée/localisée simplement parce que la catégorie exacte est incertaine.
- Ignore les points isolés de 1-3 pixels et les artefacts JPEG.

Si aucune zone n'est détectée, explique dans reasoning_summary pourquoi l'image montre seulement du voile UV/reflet/fond normal.

EXEMPLE DE SORTIE ATTENDUE (référence de format et de niveau technique — à adapter à TON image) :
{
  "language": "fr",
  "image_quality": {
    "usable": true,
    "warning": "Image exploitable ; légère surexposition locale sur certains reflets métalliques.",
    "limitations": ["Éteignez les lumières ambiantes pour réduire le voile bleu-violet de fond.", "Cadrez toute la surface inspectée afin d'éviter une sous-estimation des bords."]
  },
  "global_assessment": {
    "ambient_uv_level": "modéré",
    "inspected_area_pct": 92,
    "suspected_fluorescent_area_pct": 38,
    "holistic_distribution": "Fluorescence vert-lime étendue, irrégulière, principalement sur la moitié gauche et le bord inférieur ; voile violet uniforme rejeté comme fond UV normal."
  },
  "reasoning_summary": {
    "surface_inspected": "Pièce métallique visible presque entièrement, avec reflets sur arêtes et surface plane inspectable.",
    "ambient_uv_rejection": "Le voile bleu-violet est diffus, homogène et suit la réflexion métallique ; il n'est pas retenu comme contamination.",
    "positive_detection_basis": "Les zones vert-lime sont saturées, texturées, non uniformes et couvrent une aire significative distincte du fond UV.",
    "crop_fusion_basis": "Les crops positifs adjacents sont fusionnés en zones continues ; les crops montrant seulement le fond violet sont rejetés."
  },
  "zones": [
    { "id": "Z1", "label": "organic", "risk_score": 82, "confidence": 0.82, "bbox_normalized": {"x": 0.06, "y": 0.18, "w": 0.34, "h": 0.46}, "area_pct": 18, "intensity": "forte", "evidence": "Fluorescence vert-lime saturée, texturée et irrégulière, incompatible avec un simple voile UV uniforme.", "artifact_rejection": "Ne suit pas les arêtes métalliques ni la direction des reflets." },
    { "id": "Z2", "label": "mixed", "risk_score": 76, "confidence": 0.74, "bbox_normalized": {"x": 0.18, "y": 0.63, "w": 0.58, "h": 0.24}, "area_pct": 20, "intensity": "forte", "evidence": "Traînée fluorescente continue vert/cyan avec variations locales de texture.", "artifact_rejection": "Signal localisé et discontinu par rapport au fond violet global." }
  ],
  "overall_score": 80,
  "risk_level": "Élevé",
  "observations": [
    "La surface présente une fluorescence suspecte étendue couvrant environ un tiers à deux cinquièmes de l'aire inspectée.",
    "Le voile bleu-violet diffus est compatible avec la réflexion UV normale du métal et n'a pas été classé comme contamination.",
    "Les zones vert-lime saturées sont retenues car elles sont localisées, texturées et nettement plus intenses que le fond.",
    "La signature est compatible avec un résidu organique ou mixte, à confirmer par ATP-métrie ou écouvillonnage ciblé."
  ],
  "recommended_validation": [
    "Effectuer un écouvillonnage ATP sur Z1 et Z2.",
    "Comparer avec une photo après nettoyage pour vérifier la disparition du signal.",
    "Prélever si le résultat ATP reste élevé ou si la zone est critique HACCP."
  ],
  "differential_diagnosis": [
    { "hypothesis": "organic", "label_human": "Résidu alimentaire séché", "probability": 0.62, "urgency": "medium",
      "reasoning": "Couleur vert-lime saturée et texture irrégulière typiques d'un résidu organique sur métal.",
      "priority_test": true },
    { "hypothesis": "mixed", "label_human": "Mixte organique + chimique (rinçage incomplet)", "probability": 0.25, "urgency": "high",
      "reasoning": "Présence locale de cyan dans la traînée évoque un résidu de détergent mal rincé combiné au résidu alimentaire.",
      "priority_test": true },
    { "hypothesis": "biofilm", "label_human": "Biofilm bactérien précoce", "probability": 0.10, "urgency": "high",
      "reasoning": "Hypothèse à exclure si la zone reste humide entre nettoyages, malgré probabilité faible.",
      "priority_test": false },
    { "hypothesis": "fatty", "label_human": "Film de matière grasse", "probability": 0.03, "urgency": "low",
      "reasoning": "Improbable car la signature attendue serait orange-ambre ou irisée, non observée ici.",
      "priority_test": false }
  ]
}

Fin : respecte strictement la langue ${langName} et retourne uniquement le JSON.`;

    /* Opus 4.7 — modèle stable en prod. Sonnet 4.7 n'existe pas chez Anthropic.
       Plus cher mais meilleure précision sur disambiguation D1-D8 + few-shot rules.
       Si Opus reste saturé après 4 retries SDK → fallback Sonnet 4.6 (cf. catch).

       STREAMING (Phase 2) : on utilise client.messages.stream(...) au lieu de
       .create(...). Bénéfice clé : la connexion HTTP reste active pendant
       toute la génération, ce qui évite les timeouts intermédiaires sur les
       longues réponses Opus (40-90s typiques en effort:high). On reconstruit
       le message complet via .finalMessage() — shape identique à .create(). */
    const buildRequestArgs = (modelId) => ({
      model: modelId,
      /* max_tokens 8192 : permet output complet sur scènes complexes
         (8-12 zones × ~250 tokens enrichis + reasoning_summary + différentiel
         5 hypothèses + observations + validation + image_quality).
         Anthropic ne facture que les tokens réellement générés. */
      max_tokens: 8192,
      thinking: { type: "adaptive" },
      /* V24.1 — output_config supprimé (limite de grammar Anthropic
         empêche d'avoir tous les champs UI legacy + V21 contextuel).
         Sortie JSON pur via prompt + parsing tolérant côté backend. */
      system: [
        /* TTL 1h au lieu de 5min : sur usage HACCP typique (inspecteur faisant
           5-15 photos sur 30-60min), le cache reste valide entre les analyses.
           Coût write : 2× input (vs 1.25× en 5min) — rentable dès la 2e analyse. */
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      messages: [
        {
          role: "user",
          content: (() => {
            const blocks = [
              { type: "text", text: "═══ IMAGE GLOBALE (vue d'ensemble de la surface inspectée) ═══" },
              { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            ];
            /* Phase 1.5 — injecte un crop dédié par zone, dans l'ordre numérique */
            if (hasZoneCrops) {
              blocks.push({
                type: "text",
                text: `\n═══ ${zoneCrops.length} CROPS DÉDIÉS — un par zone, dans l'ordre ═══`
              });
              for (let i = 0; i < zoneCrops.length; i++) {
                blocks.push({
                  type: "text",
                  text: `\n— Crop hint ${i + 1} (384×384, à valider) —`
                });
                blocks.push({
                  type: "image",
                  source: { type: "base64", media_type: "image/jpeg", data: zoneCrops[i] }
                });
              }
              blocks.push({
                type: "text",
                text: `\n═══ FIN DES CROPS — instructions complètes ci-dessous ═══\n`
              });
            }
            blocks.push({ type: "text", text: userText });
            return blocks;
          })(),
        },
      ],
    });

    /* callModel : déclenche le stream et attend la finalMessage().
       Le SDK Anthropic envoie des heartbeats pendant le stream, donc Vercel
       ne coupe pas la fonction même pour des outputs de 60-90s. */
    const callModel = async (modelId) => {
      const stream = client.messages.stream(buildRequestArgs(modelId));
      return await stream.finalMessage();
    };

    /* Tentative Opus → si surcharge persistante, fallback Sonnet (transparent).
       withTimeout 110s : cap dur côté serveur même si le SDK ne timeout pas.
       Laisse 190s+ de marge avant le maxDuration Vercel (300s) pour le reste. */
    let message;
    let usedFallback = false;
    try {
      message = await withTimeout(
        callModel(PRIMARY_MODEL),
        110000,
        `Claude:${PRIMARY_MODEL}`
      );
    } catch (primaryErr) {
      const isOverload = primaryErr instanceof Anthropic.APIError
        && OVERLOAD_STATUSES.has(primaryErr.status);
      const isTimeout = primaryErr?.name === 'TimeoutError';
      if (!isOverload && !isTimeout) throw primaryErr;
      const reason = isTimeout
        ? `timeout ${primaryErr.timeoutMs}ms`
        : `saturé (${primaryErr.status})`;
      console.warn(`[ANALYZE] ${PRIMARY_MODEL} ${reason}, fallback ${FALLBACK_MODEL}`);
      message = await withTimeout(
        callModel(FALLBACK_MODEL),
        110000,
        `Claude:${FALLBACK_MODEL}`
      );
      usedFallback = true;
    }

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || !textBlock.text) {
      console.error("[ANALYZE] Réponse vide du modèle", {
        model: message?.model,
        stop_reason: message?.stop_reason,
        usage: message?.usage,
      });
      return res.status(502).json({ error: "Empty model response" });
    }

    /* V24.1 — Parsing tolérant : on accepte JSON pur OU JSON dans un bloc
       ```json...``` markdown OU JSON avec texte autour. On extrait le
       premier objet JSON valide trouvé. */
    function extractJSON(text) {
      if (!text) return null;
      try { return JSON.parse(text); } catch {}
      // Tentative : extraire ```json ... ```
      const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (fence) {
        try { return JSON.parse(fence[1]); } catch {}
      }
      // Tentative : trouver { ... } équilibré
      const start = text.indexOf('{');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < text.length; i++) {
          const c = text[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"' && !esc) inStr = !inStr;
          if (inStr) continue;
          if (c === '{') depth++;
          if (c === '}') {
            depth--;
            if (depth === 0) {
              try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
            }
          }
        }
      }
      return null;
    }
    let result = extractJSON(textBlock.text);
    if (!result) {
      try {
      result = JSON.parse(textBlock.text);
    } catch (parseErr) {
      console.error("[ANALYZE] JSON.parse échoué:", parseErr?.message || parseErr);
      console.error("[ANALYZE] Début texte modèle (1000 chars):",
        textBlock.text.slice(0, 1000));
      console.error("[ANALYZE] Fin texte modèle (200 chars):",
        textBlock.text.slice(-200));
      console.error("[ANALYZE] Métadonnées:", {
        model: message?.model,
        stop_reason: message?.stop_reason,
        output_tokens: message?.usage?.output_tokens,
        usedFallback,
      });
      return res.status(502).json({
        error: "Réponse JSON invalide du modèle. Veuillez réessayer.",
        retryable: true,
        type: "JSONParseError",
        stop_reason: message?.stop_reason || null,
      });
    }
    }

    return res.status(200).json({
      ...result,
      _meta: {
        model: message.model,
        stop_reason: message.stop_reason,
        usedFallback,
        usage: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cache_read: message.usage.cache_read_input_tokens || 0,
          cache_create: message.usage.cache_creation_input_tokens || 0,
        },
        /* Vague 3 : exposition de la variante A/B et de l'imageHash pour
           tracking côté feedback. Permet de corréler chaque feedback à la
           variante du prompt qui a généré l'analyse. */
        activeVariant: activeVariantInfo,
        imageHash,
      },
    });
  } catch (err) {
    console.error("Analysis error:", err);

    /* TimeoutError (Phase 2) : si Primary ET Fallback timeout tous les deux,
       on remonte ici. Réponse 504 retryable pour que le client puisse retry
       proprement plutôt que de voir un 500 obscur. */
    if (err?.name === 'TimeoutError') {
      return res.status(504).json({
        error: "L'analyse a dépassé le délai imparti. Veuillez réessayer.",
        retryable: true,
        type: "TimeoutError",
        label: err.label || null,
        timeoutMs: err.timeoutMs || null,
      });
    }

    if (err instanceof Anthropic.APIError) {
      /* 529/503/429 même après fallback : message FR clair, status 503 (retry) */
      if (OVERLOAD_STATUSES.has(err.status)) {
        return res.status(503).json({
          error: "Service d'analyse temporairement saturé. Veuillez réessayer dans une minute.",
          retryable: true,
          type: err.constructor.name,
        });
      }
      return res.status(err.status || 500).json({ error: err.message, type: err.constructor.name });
    }
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",   /* MODE PRÉCISION MAX : image 2576px + 24 crops 384px en HQ */
    },
  },
};

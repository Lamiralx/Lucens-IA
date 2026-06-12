/**
 * Lucens IA — Endpoint validation sémantique cluster Live View (V16)
 *
 * But : pour chaque cluster détecté par les heuristiques HSV du Live View,
 * demander à Gemini Flash si la zone est une VRAIE fluorescence ou un
 * OBJET/MATÉRIAU normal (bois, verre, plastique, métal coloré, peinture).
 *
 * Pourquoi Flash (pensée OFF) : latence ~500-900ms, coût ~$0.0005 par appel,
 * suffisant pour une question binaire avec petit crop image.
 *
 * Entrée :
 *   { image: "<base64 jpg>", mediaType: "image/jpeg" }
 *   Le crop fait typiquement 192×192 à 320×320 px, focalisé sur le cluster.
 *
 * Sortie :
 *   {
 *     verdict: "YES_FLUO" | "NO_OBJECT" | "UNCERTAIN",
 *     type: "organic|chemical|mineral|dust|fatty|pigmented|biofilm|unknown",
 *     reason: "<3-6 mots>",
 *     latencyMs: <number>
 *   }
 *
 * V255 — Claude renvoie désormais le TYPE de résidu (classification primaire).
 * Le classifieur de teinte local du client oscille (cyan↔vert selon la lampe) :
 * c'est Claude, déjà appelé par point de réticule, qui tranche la nature réelle.
 * Vocabulaire VOLONTAIREMENT VAGUE/honnête (ne pas sur-spécifier — voir prompt).
 */

import { GoogleGenAI } from "@google/genai";
import { applyCors, getClientIp, rateLimit, send429 } from "./_lib/security.js";

/* V299 — migration Haiku → Gemini Flash (crédit Anthropic épuisé). */
const GEMINI_KEY = process.env.Gemini_API_KEY || process.env.GEMINI_API_KEY;
const genai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

/* Modèle : Gemini 2.5 Flash — rapide et bon marché. PENSÉE DÉSACTIVÉE
   (thinkingBudget:0) pour tenir la cible de latence <800ms du juge Live View. */
const MODEL = "gemini-2.5-flash";

/* Rate limit : 240 validations / minute / IP — protège du burst sans
   bloquer les sessions intensives. */
const RATE_LIMIT_PER_MIN = 240;

const SYSTEM_PROMPT = `Tu es un classifieur visuel binaire ultra-rapide pour Lucens IA, un système d'inspection par fluorescence UV-A 365 nm.

Tu reçois un PETIT CROP d'image (zone localisée d'une photo sous UV) et tu dois décider en UNE SEULE classification :

- **YES_FLUO** : la zone montre une vraie fluorescence (Stokes shift, émission propre). Indices : couleur vive saturée avec glow diffus, halo doux progressif, signature compatible avec un résidu HACCP (détergent bleu-cyan, biofilm vert-jaune, urine jaune-orange brillante, sang rouge, lait jaune-vert, huile minérale bleu-vert irisée).

- **NO_OBJECT** : la zone montre un OBJET ou MATÉRIAU normal coloré sous UV qui n'est PAS une fluorescence. Indices : texture de matériau (grain de bois, fibres carton, surface plastique lisse uniforme, reflet métallique, transparence verre, surface peinte mate, surface texturée régulière géométrique, étiquette, écran allumé, LED).

- **UNCERTAIN** : signal ambigu, ni clairement fluo, ni clairement objet. À utiliser avec parcimonie.

Quand verdict = YES_FLUO, tu CLASSES la NATURE du résidu via "type".

⚠️ NE DÉCIDE PAS À LA COULEUR SEULE. Sous UV-A la balance des blancs du téléphone voile TOUT en bleu : un résidu BLANC (fromage, lait, calcaire) paraît souvent bleuté → si tu te fies à la couleur, tu le classes "chimique" À TORT. Décide avec TROIS critères ENSEMBLE : COULEUR + TEXTURE (granuleux/relief 3D vs lisse/film uniforme) + FORME (goutte compacte vs tache étalée à bords flous vs film vs mouchetures éparses). La TEXTURE et la FORME priment sur la couleur pour les résidus pâles.

- **organic** : matière organique / alimentaire / biologique. Indices : vert-jaune diffus, OU surface BLANCHE/claire GRANULEUSE, opaque, en RELIEF 3D, à grain irrégulier (fromage, lait séché, miette, résidu protéique). ⚠️ Un blanc/pâle GRANULEUX et opaque = ORGANIQUE, PAS chimique.
- **chemical** : produit chimique (savon, nettoyant, azurant). Indices STRICTS : film LISSE, plat, uniforme, sans relief ni grain, légèrement bleu-cyan, bords nets (coulure/goutte étalée lisse). RESTE VAGUE : ne dis pas "détergent"/"rinçage". Si c'est granuleux ou en relief → ce n'est PAS chimical.
  ⚠️ ERREUR LA PLUS FRÉQUENTE À ÉVITER : conclure "chemical" parce que la teinte paraît bleu-cyan. Le voile UV bleute TOUTE la scène. Le bleu-cyan SEUL ne suffit JAMAIS pour "chemical" : il FAUT un film lisse confirmé. Bleu-cyan + grain / relief / aspect nuageux / mouchetures → organic, biofilm, mineral ou dust, PAS chemical.
- **mineral** : tartre / calcaire. Indices : tache DIFFUSE, blanc-gris NEUTRE (pas franchement bleue), aspect poudreux/cristallin/crayeux, contours FLOUS, peu lumineuse, sur zone d'eau/séchage.
- **dust** : MOUCHETURES fines, ternes, ÉPARSES/dispersées (pas une tache continue).
- **fatty** : orange-ambre irisé, halo gras brillant.
- **pigmented** : rouge-rose → sang, porphyrines, pigments.
- **biofilm** : voile STRUCTURÉ le long des joints / zones humides → biofilm potentiel.
- **unknown** : fluorescence RÉELLE mais nature indéterminée (RAREMENT).

RÈGLES STRICTES :
1. Réponds UNIQUEMENT au format JSON exact : {"verdict":"YES_FLUO|NO_OBJECT|UNCERTAIN","type":"organic|chemical|mineral|dust|fatty|pigmented|biofilm|unknown","reason":"3 à 6 mots maximum"}
2. PAS de texte avant ou après le JSON
3. La raison doit nommer l'INDICE DÉCISIF (matériau + texture/forme), ex: "blanc granuleux opaque", "film bleu lisse", "tache crayeuse diffuse", "grain bois clair", "mouchetures éparses"
4. Si la zone montre principalement du métal nu, plastique uniforme, bois, carton, verre, écran ou LED → NO_OBJECT systématique
5. Si la zone montre un halo diffus saturé sans texture de matériau → YES_FLUO
6. En cas de doute réel entre les deux → UNCERTAIN
7. "type" est OBLIGATOIRE. Si verdict ≠ YES_FLUO → "type":"unknown". Si verdict = YES_FLUO → choisis le type le PLUS plausible (préfère un type concret à "unknown").

Tu DOIS répondre en <800ms. Sois décisif.`;

export default async function handler(req, res) {
  /* V38 fix F-13 : applyCors() ne retourne rien — le pattern `if (...) return;`
     ne capturait jamais les pre-flight OPTIONS, qui tombaient sur le 405 et
     bloquaient Safari iOS. On gère OPTIONS explicitement. */
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  /* V38 fix F-02 : la signature de rateLimit() est `{ scope, ip, limit,
     windowSec }` (objet destructuré, voir _lib/security.js). L'appel
     positionnel précédent passait un string comme 1er arg → destructuré
     en undefined → rate limit totalement inopérant → drain Anthropic
     Haiku possible. send429 attend `retryAfter` (nombre), pas l'objet rl. */
  const ip = getClientIp(req);
  const rl = await rateLimit({ scope: 'validate-cluster', ip, limit: RATE_LIMIT_PER_MIN, windowSec: 60 });
  if (!rl.ok) {
    send429(res, rl.retryAfter);
    return;
  }

  const { image, mediaType, lang } = req.body || {};
  if (!image || typeof image !== 'string' || image.length < 100) {
    res.status(400).json({ error: 'Missing or invalid image base64' });
    return;
  }
  const mt = (mediaType === 'image/png' || mediaType === 'image/webp') ? mediaType : 'image/jpeg';
  /* V124 — Langue de la "reason" : avant, toujours en français → bandeau Live View
     mixte (ex: "NOT FLUO · clavier RGB" quand l'app est en anglais). On force
     Claude à écrire reason dans la langue de l'app. */
  const LANG_NAMES = { fr: 'français', en: 'English', es: 'español', de: 'Deutsch' };
  const langName = LANG_NAMES[String(lang || '').toLowerCase()] || 'français';

  const t0 = Date.now();
  try {
    if (!genai) throw new Error('Gemini key missing');
    const resp = await genai.models.generateContent({
      model: MODEL,
      contents: [
        { inlineData: { mimeType: mt, data: image } },
        { text: 'Classifie cette zone. JSON uniquement. La valeur "reason" doit être écrite en ' + langName + ' (3 à 6 mots).' }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 256,
        responseMimeType: 'application/json',
        /* pensée OFF : un juge binaire doit rester sous ~800ms */
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const latencyMs = Date.now() - t0;
    const raw = ((typeof resp?.text === 'string' && resp.text)
      ? resp.text
      : (resp?.candidates?.[0]?.content?.parts || []).map(p => p?.text).filter(Boolean).join('')).trim();

    /* Parse JSON robuste — on accepte les variations de wrapping */
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[^}]*"verdict"[^}]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }

    if (!parsed || !parsed.verdict) {
      res.status(200).json({ verdict: 'UNCERTAIN', type: 'unknown', reason: 'parse_failed', latencyMs });
      return;
    }

    const verdict = ['YES_FLUO', 'NO_OBJECT', 'UNCERTAIN'].includes(parsed.verdict)
      ? parsed.verdict : 'UNCERTAIN';
    const reason = String(parsed.reason || '').slice(0, 60);

    /* V255 — Whitelist du TYPE renvoyé par Claude. Vocabulaire fixe ; tout hors
       liste retombe sur 'unknown'. Si verdict ≠ YES_FLUO, le type n'a pas de sens
       → forcé à 'unknown'. On ne renvoie JAMAIS de type vide (le client compte
       dessus pour piloter la bannière). */
    const TYPES = ['organic', 'chemical', 'mineral', 'dust', 'fatty', 'pigmented', 'biofilm', 'unknown'];
    let type = 'unknown';
    if (verdict === 'YES_FLUO') {
      const t = String(parsed.type || '').toLowerCase().trim();
      type = TYPES.includes(t) ? t : 'unknown';
    }

    res.status(200).json({ verdict, type, reason, latencyMs });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    /* En cas d'erreur réseau/API, on retourne UNCERTAIN plutôt que 500
       pour ne pas casser le flow Live View. Le client peut continuer. */
    res.status(200).json({
      verdict: 'UNCERTAIN',
      type: 'unknown',
      reason: 'api_error',
      latencyMs,
      error: String(err?.message || err).slice(0, 120),
    });
  }
}

export const config = {
  maxDuration: 10,
  runtime: 'nodejs',
};

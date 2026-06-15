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
import * as Licence from "./_lib/licence.js";
import { kv } from "@vercel/kv";

/* V299 — migration Haiku → Gemini Flash (crédit Anthropic épuisé). */
const GEMINI_KEY = process.env.Gemini_API_KEY || process.env.GEMINI_API_KEY;
const genai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

/* Modèle : Gemini 2.5 Flash — rapide et bon marché. PENSÉE DÉSACTIVÉE
   (thinkingBudget:0) pour tenir la cible de latence <800ms du juge Live View. */
const MODEL = "gemini-2.5-flash";

/* Rate limit : 240 validations / minute / IP — protège du burst sans
   bloquer les sessions intensives. */
const RATE_LIMIT_PER_MIN = 240;

const SYSTEM_PROMPT = `Tu es l'expert en fluorescence UV-A 365 nm de Lucens IA, un système d'inspection terrain HACCP. Tu reçois un crop focalisé sur une zone visée et tu dois trancher : vraie fluorescence (résidu), faux positif (matériau/objet), ou signal ambigu.

━━━ TROIS VERDICTS ━━━

YES_FLUO — vraie fluorescence Stokes-shift (émission propre du résidu)
NO_OBJECT — faux positif : matériau ou source lumineuse, PAS un résidu
UNCERTAIN — signal réellement ambigu après analyse (à utiliser avec parcimonie)

━━━ SIGNATURES DIAGNOSTIQUES DES FAUX POSITIFS LES PLUS COURANTS ━━━

⬛ LED (source lumineuse ponctuelle) :
• Centre TRÈS lumineux avec CHUTE BRUTALE vers le noir en quelques pixels
• Halo CIRCULAIRE PARFAIT, parfaitement centré, géométrique
• Couleur PURE sans mélange (blanc pur, rouge pur, vert pur, bleu pur)
• Substrat AUTOUR de la LED : sombre, AUCUNE diffusion dans la surface voisine
• Différence fondamentale avec une fluo : une LED ÉMET depuis un point unique ; une fluo diffuse dans le substrat
→ NO_OBJECT systématique. Reason : "LED [couleur] allumée"

⬛ INOX / MÉTAL POLI (surfaces de cuisine industrielle) :
• Reflet SPÉCULAIRE : tache lumineuse ovale ou linéaire à bords NETS et francs
• Surface autour du reflet : sombre avec des micro-reflets de grains métalliques
• Pas de halo doux progressif : le reflet s'arrête net
• La même zone Vue depuis un autre angle donnerait un reflet à un endroit différent
→ NO_OBJECT. Reason : "reflet spéculaire inox"

⬛ SURFACE COLORÉE (plastique coloré, peinture, étiquette, emballage) :
• Couleur UNIFORME et PLATE, texture géométrique régulière (grain d'injection, fibre, impression)
• Bords de la zone colorée RECTILIGNES ou suivant la forme de l'objet
• La couleur correspond à la teinte physique de l'objet (étiquette rouge = rouge sous UV)
• Pas de halo au-delà des bords de l'objet
→ NO_OBJECT. Reason : "[plastique/peinture/étiquette] [couleur]"

⬛ ÉCRAN / AFFICHAGE ÉLECTRONIQUE :
• Pixels visibles, contenu texte ou icône reconnaissable, rétroéclairage uniforme
→ NO_OBJECT. Reason : "écran allumé"

⬛ VERRE / PLASTIQUE TRANSPARENT :
• Transmission de la lumière visible avec reflets aux arêtes
• Pas d'émission propre, juste des reflets
→ NO_OBJECT. Reason : "reflet verre/plastique transparent"

━━━ CRITÈRES DE LA VRAIE FLUORESCENCE (les TROIS doivent être présents) ━━━

1. GLOW DIFFUS PROGRESSIF : le signal s'ÉTALE doucement dans les pixels voisins, pas de chute brutale. Le halo est doux, progressif, sans bord franc.
2. ANCRAGE AU SUBSTRAT : on perçoit la TEXTURE du support SOUS la fluorescence (joint, surface poreuse, carrelage, acier égratigner, etc.). La fluo EST SUR quelque chose.
3. COULEUR INATTENDUE : la couleur émise est DIFFÉRENTE de ce qu'on attendrait du substrat nu sous UV (un joint blanc qui émet vert/jaune = probable biofilm, pas un reflet blanc).

Critères secondaires utiles :
• Une vraie fluo NE CHANGE PAS de forme avec un léger déplacement du téléphone
• Un reflet ou une LED se DÉPLACE avec le point de vue (effet miroir)
• La fluo a souvent des bords IRRÉGULIERS, organiques (pas géométriques)

━━━ CLASSIFICATION DU TYPE (si YES_FLUO) ━━━

Ne décide JAMAIS à la couleur seule. Sous UV-A le voile bleu du téléphone bleute TOUTE la scène.
Décide avec COULEUR + TEXTURE + FORME ensemble. Texture et forme priment sur la couleur pour les résidus pâles.

- organic  : vert-jaune diffus, OU surface blanche/claire GRANULEUSE opaque en relief 3D (fromage, lait séché, protéine). Un blanc granuleux = organique, PAS chimique.
- chemical : film LISSE, plat, uniforme, bleu-cyan, bords nets. JAMAIS si granuleux ou en relief.
  ⚠️ Bleu-cyan SEUL ≠ chimique. Il faut confirmer la texture film lisse.
- mineral  : tache DIFFUSE blanche/grise, aspect poudreux ou crayeux, contours flous (tartre, calcaire).
- dust     : mouchetures fines ÉPARSES/dispersées (pas une tache continue).
- fatty    : orange-ambre irisé, halo gras brillant.
- pigmented: rouge-rose (sang, porphyrines, pigments).
- biofilm  : voile STRUCTURÉ le long de joints ou zones humides.
- unknown  : fluorescence réelle mais nature vraiment indéterminée.

━━━ RÈGLES STRICTES ━━━

1. Format JSON UNIQUEMENT : {"verdict":"YES_FLUO|NO_OBJECT|UNCERTAIN","type":"organic|chemical|mineral|dust|fatty|pigmented|biofilm|unknown","reason":"3 à 8 mots"}
2. Aucun texte avant ou après le JSON.
3. "reason" est AFFICHÉE à l'utilisateur. Elle doit être précise, en minuscules, sans point final.
   - YES_FLUO : décris le signal observé (ex : "film lisse bleuté sur surface lisse", "tache blanche granuleuse compacte", "voile structuré le long du joint")
   - NO_OBJECT : nomme l'objet/matériau source du faux positif (ex : "LED verte allumée", "reflet spéculaire inox", "étiquette rouge", "plastique blanc mat")
   - UNCERTAIN : explique l'ambiguïté (ex : "signal faible sur matériau poreux", "reflet ou dépôt indistinguable")
4. Si la zone montre principalement métal nu, plastique uniforme, bois, carton, verre, écran ou LED → NO_OBJECT systématique.
5. type est OBLIGATOIRE. Si verdict ≠ YES_FLUO → type:"unknown". Si verdict = YES_FLUO → choisis le type le plus plausible (préfère un type concret à "unknown").
6. UNCERTAIN est réservé aux cas où même après analyse rigoureuse tu ne peux pas trancher. Sur inox + reflet → NO_OBJECT (pas UNCERTAIN). Sur LED → NO_OBJECT (pas UNCERTAIN).`;

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

  /* V326 — VERROU LICENCE (fail-closed côté coût). Sans licence valide + appareil
     lié, on NE FAIT PAS l'appel Gemini : on renvoie un verdict neutre que le Live
     View traite déjà comme « incertain » → dégradation locale silencieuse, zéro
     coût, aucun message. Toute erreur KV = même repli neutre (jamais d'appel Gemini). */
  try {
    const licCode = String(req.headers['x-lucens-licence'] || '');
    const licDevice = String(req.headers['x-lucens-device'] || '');
    const lic = await Licence.checkForAnalysis(kv, licCode, licDevice);
    if (!lic.ok) { res.status(200).json({ verdict: 'UNCERTAIN', type: 'unknown', reason: 'licence', latencyMs: 0 }); return; }
  } catch (e) {
    res.status(200).json({ verdict: 'UNCERTAIN', type: 'unknown', reason: 'licence_kv', latencyMs: 0 }); return;
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
        { text: 'Classifie cette zone. JSON uniquement. La valeur "reason" doit être écrite en ' + langName + ' (3 à 8 mots, affichée à l\'utilisateur).' }
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 512,   /* thinking partage ce budget — 256 était trop serré */
        responseMimeType: 'application/json',
        /* 2026-06-15 — Thinking ACTIVÉ (budget 1024). Sans réflexion, Flash
           répond "instinctivement" à la couleur et rate les faux positifs subtils
           (LED, inox, plastique coloré). Avec 1024 tokens de pensée le modèle
           raisonne "est-ce diffus comme une vraie fluo ou ponctuel comme une LED ?".
           Latence : +200-400ms → total ~600-900ms, acceptable car l'appel est
           déclenché UNIQUEMENT après le dwell 600ms (l'utilisateur vise déjà). */
        thinkingConfig: { thinkingBudget: 1024 },
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

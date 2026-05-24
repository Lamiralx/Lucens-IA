/**
 * Lucens IA — Endpoint validation sémantique cluster Live View (V16)
 *
 * But : pour chaque cluster détecté par les heuristiques HSV du Live View,
 * demander à Claude Haiku si la zone est une VRAIE fluorescence ou un
 * OBJET/MATÉRIAU normal (bois, verre, plastique, métal coloré, peinture).
 *
 * Pourquoi Haiku : latence ~600-900ms médiane, coût ~$0.0002 par appel,
 * suffisant pour une question binaire avec petit crop image.
 *
 * Entrée :
 *   { image: "<base64 jpg>", mediaType: "image/jpeg" }
 *   Le crop fait typiquement 192×192 à 320×320 px, focalisé sur le cluster.
 *
 * Sortie :
 *   {
 *     verdict: "YES_FLUO" | "NO_OBJECT" | "UNCERTAIN",
 *     reason: "<3-6 mots>",
 *     latencyMs: <number>
 *   }
 */

import Anthropic from "@anthropic-ai/sdk";
import { applyCors, getClientIp, rateLimit, send429 } from "./_lib/security.js";

const client = new Anthropic({ maxRetries: 1, timeout: 8000 });

/* Modèle : Haiku 4.5 — le plus rapide. Précision suffisante pour binaire visuel. */
const MODEL = "claude-haiku-4-5";

/* Rate limit : 240 validations / minute / IP — protège du burst sans
   bloquer les sessions intensives. */
const RATE_LIMIT_PER_MIN = 240;

const SYSTEM_PROMPT = `Tu es un classifieur visuel binaire ultra-rapide pour Lucens IA, un système d'inspection par fluorescence UV-A 365 nm.

Tu reçois un PETIT CROP d'image (zone localisée d'une photo sous UV) et tu dois décider en UNE SEULE classification :

- **YES_FLUO** : la zone montre une vraie fluorescence (Stokes shift, émission propre). Indices : couleur vive saturée avec glow diffus, halo doux progressif, signature compatible avec un résidu HACCP (détergent bleu-cyan, biofilm vert-jaune, urine jaune-orange brillante, sang rouge, lait jaune-vert, huile minérale bleu-vert irisée).

- **NO_OBJECT** : la zone montre un OBJET ou MATÉRIAU normal coloré sous UV qui n'est PAS une fluorescence. Indices : texture de matériau (grain de bois, fibres carton, surface plastique lisse uniforme, reflet métallique, transparence verre, surface peinte mate, surface texturée régulière géométrique, étiquette, écran allumé, LED).

- **UNCERTAIN** : signal ambigu, ni clairement fluo, ni clairement objet. À utiliser avec parcimonie.

RÈGLES STRICTES :
1. Réponds UNIQUEMENT au format JSON exact : {"verdict":"YES_FLUO|NO_OBJECT|UNCERTAIN","reason":"3 à 6 mots maximum"}
2. PAS de texte avant ou après le JSON
3. La raison doit nommer le matériau probable (ex: "grain bois clair", "plastique bleu lisse", "vraie tache cyan glow", "verre reflet bleu")
4. Si la zone montre principalement du métal nu, plastique uniforme, bois, carton, verre, écran ou LED → NO_OBJECT systématique
5. Si la zone montre un halo diffus saturé sans texture de matériau → YES_FLUO
6. En cas de doute réel entre les deux → UNCERTAIN

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

  const { image, mediaType } = req.body || {};
  if (!image || typeof image !== 'string' || image.length < 100) {
    res.status(400).json({ error: 'Missing or invalid image base64' });
    return;
  }
  const mt = (mediaType === 'image/png' || mediaType === 'image/webp') ? mediaType : 'image/jpeg';

  const t0 = Date.now();
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 80,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
          { type: 'text', text: 'Classifie cette zone. JSON uniquement.' }
        ]
      }]
    });

    const latencyMs = Date.now() - t0;
    const raw = resp.content?.[0]?.text?.trim() || '';

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
      res.status(200).json({ verdict: 'UNCERTAIN', reason: 'parse_failed', latencyMs });
      return;
    }

    const verdict = ['YES_FLUO', 'NO_OBJECT', 'UNCERTAIN'].includes(parsed.verdict)
      ? parsed.verdict : 'UNCERTAIN';
    const reason = String(parsed.reason || '').slice(0, 60);

    res.status(200).json({ verdict, reason, latencyMs });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    /* En cas d'erreur réseau/Anthropic, on retourne UNCERTAIN plutôt que 500
       pour ne pas casser le flow Live View. Le client peut continuer. */
    res.status(200).json({
      verdict: 'UNCERTAIN',
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

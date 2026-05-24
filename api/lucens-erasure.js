/**
 * /api/lucens-erasure — Droit à l'oubli RGPD sans login
 *
 * L'utilisateur qui a soumis un feedback ou une capture corrective a reçu
 * un deleteToken en clair UNE FOIS lors de la réponse de /api/feedback.
 * Ce token n'est jamais stocké en clair côté serveur (seul son hash SHA-256
 * est conservé dans l'index `lucens:forget:<hash>`).
 *
 * Endpoints :
 *   POST   { deleteToken }       → vérifier si une entrée est encore retrouvable
 *   DELETE { deleteToken }       → effacer le feedback et le case associés
 *
 * Pas d'auth admin requise : le token suffit. Pas de PII collectée.
 * Pas de query token autorisé (uniquement body) pour éviter fuite logs.
 *
 * Référence : EDPB Guidelines on Pseudonymisation, EU AI Act,
 * RGPD Article 17 (droit à l'effacement).
 */

import { applyCors, getClientIp, rateLimit, send429 } from './_lib/security.js';
import crypto from 'crypto';

const MIN_TOKEN_LEN = 24;
const MAX_TOKEN_LEN = 80;

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* Rate limit anti-bruteforce : 10 tentatives par heure par IP.
     Un attaquant qui essaierait de deviner des deleteTokens en masse
     verrait son IP bloquée rapidement. Le token est cryptographique
     (24 bytes randomBytes = 192 bits d'entropie) donc impossible à deviner. */
  const ip = getClientIp(req);
  const rl = await rateLimit({ scope: 'erasure', ip, limit: 10, windowSec: 3600 });
  if (!rl.ok) return send429(res, rl.retryAfter);

  const body = req.body || {};
  const deleteToken = typeof body.deleteToken === 'string' ? body.deleteToken.trim() : '';
  if (!deleteToken || deleteToken.length < MIN_TOKEN_LEN || deleteToken.length > MAX_TOKEN_LEN) {
    return res.status(400).json({ error: 'Invalid delete token format' });
  }

  try {
    const { kv } = await import('@vercel/kv');
    const tokenHash = sha256Hex(deleteToken);
    const indexRaw = await kv.get(`lucens:forget:${tokenHash}`);

    if (!indexRaw) {
      /* Volontairement vague : on ne distingue pas "token invalide" de
         "token expiré" ou "déjà supprimé" pour ne pas révéler quels
         tokens ont existé. Cohérent avec OWASP. */
      return res.status(404).json({
        ok: false,
        message: "Aucune donnée associée à ce code n'a été trouvée. Elle a peut-être déjà été supprimée ou a expiré.",
      });
    }

    const index = typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw;

    /* Mode POST : vérification (l'utilisateur veut savoir ce qu'on a sur lui)
       Ne révèle pas le contenu, juste la présence et le type. */
    if (req.method === 'POST') {
      return res.status(200).json({
        ok: true,
        found: true,
        hasFeedback: !!index.feedbackId,
        hasCase: !!index.caseId,
        createdAt: index.createdAt || null,
        message: "Des données sont associées à ce code. Utilisez DELETE pour les supprimer définitivement.",
      });
    }

    /* Mode DELETE : suppression effective. On efface :
       - Le case (photo + masque) s'il existe
       - L'index lucens:forget pour invalider le token
       Les compteurs hebdomadaires ne sont PAS modifiés (déjà agrégés
       statistiquement, non identifiables individuellement).
       Les entrées dans lucens:feedback:recent et lucens:feedback:negative
       ne sont pas modifiées non plus car ce sont des listes en O(N) qui
       seraient coûteuses à purger pour un seul item ; elles tournent en
       FIFO et seront naturellement évincées. */
    if (index.caseId) {
      await kv.del(`lucens:cases:${index.caseId}`).catch(() => {});
    }
    await kv.del(`lucens:forget:${tokenHash}`).catch(() => {});

    /* Audit log d'effacement (hash tronqué uniquement, pas le token).
       Sert à prouver la conformité RGPD lors d'un audit externe. */
    await kv.lpush('lucens:audit:erasure', JSON.stringify({
      timestamp: Date.now(),
      tokenHashPrefix: tokenHash.slice(0, 16),
      caseId: index.caseId || null,
      feedbackId: index.feedbackId || null,
      status: 'deleted',
    })).catch(() => {});
    await kv.ltrim('lucens:audit:erasure', 0, 999).catch(() => {});

    return res.status(200).json({
      ok: true,
      deleted: true,
      message: "Les données associées ont été supprimées. La suppression est définitive et irréversible.",
    });
  } catch (err) {
    console.error('[ERASURE_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

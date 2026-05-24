/**
 * /api/lucens-followup — Suivi terrain post-feedback (Vague 4B)
 *
 * Reçoit un retour utilisateur N jours après un feedback initial, pour
 * fermer la boucle qualité : "Le re-nettoyage a-t-il fonctionné ?
 * L'ATP est-il passé ?"
 *
 * C'est le KPI business ultime de Lucens IA : "combien de fois notre
 * analyse a-t-elle permis d'éviter un produit contaminé livré".
 *
 * POST body : { caseId, atpResult: "pass"|"fail", atpRlu?: number, userSessionId? }
 *
 * Stockage :
 *   - Annotation du case original avec atpResult (boucle fermée)
 *   - lucens:followups:list : index global pour stats
 *   - lucens:followups:atp_outcomes : compteurs hebdomadaires pass/fail
 *
 * Aucune auth admin requise : l'utilisateur identifie son caseId
 * via son localStorage local (lucens_followups). Anti-spam : rate-limit
 * 20/h par IP + dedup par caseId (un même cas ne peut pas être suivi 2x).
 */

import { applyCors, getClientIp, rateLimit, send429 } from './_lib/security.js';

const VALID_RESULTS = new Set(['pass', 'fail', 'pending', 'inconclusive']);
const CASE_ID_REGEX = /^case_user_fb_[a-z0-9_]+$/i;

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await rateLimit({ scope: 'followup', ip, limit: 20, windowSec: 3600 });
  if (!rl.ok) return send429(res, rl.retryAfter);

  const body = req.body || {};
  const { caseId, atpResult, atpRlu, userSessionId, notes } = body;

  if (!caseId || typeof caseId !== 'string' || !CASE_ID_REGEX.test(caseId)) {
    return res.status(400).json({ error: 'Invalid or missing caseId' });
  }
  if (!atpResult || !VALID_RESULTS.has(atpResult)) {
    return res.status(400).json({ error: 'Invalid atpResult. Must be one of: pass | fail | pending | inconclusive' });
  }

  try {
    const { kv } = await import('@vercel/kv');

    /* Vérifie que le case existe encore */
    const caseRaw = await kv.get(`lucens:cases:${caseId}`);
    if (!caseRaw) {
      return res.status(404).json({ error: 'Case not found or expired' });
    }
    const caseDoc = typeof caseRaw === 'string' ? JSON.parse(caseRaw) : caseRaw;

    /* Dedup : on n'enregistre qu'un seul follow-up par caseId */
    if (caseDoc.followUp) {
      return res.status(409).json({ error: 'Follow-up already recorded for this case' });
    }

    /* Annotation du case avec le résultat ATP */
    caseDoc.followUp = {
      atpResult,
      atpRlu: typeof atpRlu === 'number' ? atpRlu : null,
      notes: typeof notes === 'string' ? notes.slice(0, 200) : null,
      submittedAt: Date.now(),
      userSessionId: userSessionId || null,
    };
    await kv.set(`lucens:cases:${caseId}`, JSON.stringify(caseDoc), { ex: 60 * 60 * 24 * 365 });

    /* Stats hebdomadaires des résultats ATP */
    const wk = isoWeekKey(new Date());
    await kv.hincrby(`lucens:stats:${wk}:atp_outcomes`, atpResult, 1);
    await kv.hincrby(`lucens:stats:${wk}:atp_outcomes`, 'total', 1);

    /* Index global des follow-ups (pour dashboard admin) */
    await kv.lpush('lucens:followups:list', JSON.stringify({
      caseId,
      atpResult,
      atpRlu: caseDoc.followUp.atpRlu,
      submittedAt: caseDoc.followUp.submittedAt,
      originalTimestamp: caseDoc.timestamp,
      daysDelta: Math.round((caseDoc.followUp.submittedAt - caseDoc.timestamp) / 86400000),
    }));
    await kv.ltrim('lucens:followups:list', 0, 299);

    /* Bonus réputation : un user qui clôt sa boucle qualité gagne du
       trust historique (signal fort qu'il est sérieux). */
    if (userSessionId && /^[a-z0-9-]+$/i.test(userSessionId) && userSessionId.length >= 8) {
      try {
        await kv.hincrby(`lucens:user:${userSessionId}`, 'followUpsClosed', 1);
        await kv.expire(`lucens:user:${userSessionId}`, 60 * 60 * 24 * 540);
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      recorded: true,
      caseId,
      atpResult,
      message: 'Merci. Votre suivi terrain ferme la boucle qualité et améliore Lucens IA.',
    });
  } catch (err) {
    console.error('[FOLLOWUP_ERROR]', err);
    return res.status(500).json({ error: 'Internal error', detail: String(err?.message || err) });
  }
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

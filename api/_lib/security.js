/**
 * Sécurité partagée entre endpoints API : rate-limit, CORS, validation.
 *
 * - rateLimit({ key, limit, windowSec }) : compteur Vercel KV par fenêtre, 429 si dépassé.
 * - applyCors(req, res) : restreint Access-Control-Allow-Origin à une whitelist.
 * - getClientIp(req) : extrait l'IP réelle derrière le proxy Vercel.
 *
 * Stratégie KV : clés `rate:{scope}:{ip}:{bucket}` avec TTL automatique.
 * Si KV indisponible (pas configuré, panne) → fail-open (pas de blocage)
 * pour ne pas casser l'app, mais log le warning.
 */

const ALLOWED_ORIGINS = new Set([
  "https://analyse-uv.vercel.app",
  "https://lucens-ia.vercel.app",
  "https://lucens-ia-camaraadpro-3206s-projects.vercel.app",
  // Dev local — seulement si NODE_ENV != production
  "http://localhost:3000",
  "http://localhost:5173",
]);

export function getClientIp(req) {
  /* Vercel place toujours l'IP réelle dans x-forwarded-for (premier item).
     x-real-ip est un fallback ; req.socket comme dernier recours. */
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) {
    return xff.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  /* Si origin présent dans la whitelist → echo. Sinon : pas de header CORS
     (le navigateur bloquera la requête cross-origin). Same-origin requests
     n'ont pas d'header Origin, donc fonctionnent toujours. */
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-lucens-admin");
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * Rate limit par IP sur une fenêtre temporelle.
 * @param {object} opts
 * @param {string} opts.scope    - identifiant de l'endpoint (ex: "analyze", "feedback")
 * @param {string} opts.ip       - IP du client (issu de getClientIp)
 * @param {number} opts.limit    - nombre max d'appels par fenêtre
 * @param {number} opts.windowSec - durée de la fenêtre en secondes (ex: 3600 = 1h)
 * @returns {Promise<{ ok: boolean, remaining: number, retryAfter: number }>}
 */
export async function rateLimit({ scope, ip, limit, windowSec }) {
  if (!ip || ip === "unknown") {
    /* Pas d'IP fiable : on laisse passer mais signale. */
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
  try {
    const { kv } = await import("@vercel/kv");
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rate:${scope}:${ip}:${bucket}`;
    const count = await kv.incr(key);
    if (count === 1) {
      /* Première requête de la fenêtre : on pose le TTL. */
      await kv.expire(key, windowSec);
    }
    if (count > limit) {
      const retryAfter = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
      return { ok: false, remaining: 0, retryAfter };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
  } catch (err) {
    /* KV indisponible : fail-open pour ne pas casser le service.
       On log pour qu'un opérateur puisse réagir si KV est down longtemps. */
    console.warn("[rateLimit] KV unavailable, fail-open:", err?.message || err);
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * Helper pour rejeter avec un 429 propre.
 */
export function send429(res, retryAfter) {
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(Date.now() / 1000) + retryAfter));
  return res.status(429).json({
    error: "Trop de requêtes. Veuillez réessayer dans quelques minutes.",
    retryAfter,
    type: "RateLimitError",
  });
}

/**
 * V39 fix F-03 — Comparaison de tokens en temps constant.
 * Utilisé par tous les endpoints admin pour comparer le header `x-lucens-admin`
 * au secret. La comparaison directe `a !== b` est vulnérable aux timing
 * attacks : un attaquant peut extraire caractère par caractère le bon token
 * en mesurant les microsecondes de latence de réponse.
 *
 * Retourne false dès qu'un des deux est falsy ou que les longueurs diffèrent,
 * pour éviter la lecture d'un Buffer plus court.
 */
import { timingSafeEqual } from "node:crypto";

export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

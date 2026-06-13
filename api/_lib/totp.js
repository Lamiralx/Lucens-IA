/**
 * 2FA admin Lucens — TOTP (RFC 6238) + sessions signées + codes de secours.
 *
 * HELPER (_lib), PAS une route → ne compte pas dans la limite de 12 fonctions
 * serverless (Hobby). Aucune dépendance externe : tout repose sur node:crypto
 * (HMAC-SHA1 pour TOTP, HMAC-SHA256 pour les sessions). Fonctions PURES et
 * testables (vecteurs RFC 6238 dans .claude/tests/totp-unit.mjs).
 *
 * Modèle : un 2ᵉ facteur EN PLUS du token admin existant.
 *   - Le secret TOTP est généré DANS LE NAVIGATEUR à l'enrôlement (jamais en
 *     clair dans les logs/chat), confirmé par un code, puis stocké en KV.
 *   - Après token + code valides → session signée (HMAC) de durée limitée :
 *     l'utilisateur ne re-tape pas le code à chaque action.
 *   - Codes de secours (perte du téléphone) : usage unique, stockés HASHÉS.
 *   - Repli d'urgence : variable d'env LUCENS_ADMIN_2FA_OFF=1 (compte Vercel).
 */

import { createHmac, createHash, timingSafeEqual, randomInt } from "node:crypto";

/* ─── Comparaison constant-time de chaînes ─────────────────────────────── */
export function safeEqualStr(a, b) {
  const A = Buffer.from(String(a == null ? "" : a));
  const B = Buffer.from(String(b == null ? "" : b));
  if (A.length !== B.length) {
    try { timingSafeEqual(A, A); } catch { /* noop */ }
    return false;
  }
  return timingSafeEqual(A, B);
}

/* ─── Base32 (RFC 4648, alphabet standard A-Z2-7 — requis par les apps TOTP) ─ */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const s = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const c of s) {
    const idx = B32.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/* ─── HOTP (RFC 4226) puis TOTP (RFC 6238) ─────────────────────────────── */
function hotp(keyBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", keyBuf).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, "0");
}

/* Code TOTP 6 chiffres pour un secret base32 à l'instant `unixSeconds` (pas 30 s). */
export function totpCodeAt(secretB32, unixSeconds) {
  return hotp(base32Decode(secretB32), Math.floor(unixSeconds / 30));
}

/* Vérifie un code à ±`window` pas (tolérance de dérive d'horloge ; défaut ±1). */
export function verifyTotp(secretB32, code, { nowMs = Date.now(), window = 1 } = {}) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(nowMs / 1000 / 30);
  const key = base32Decode(secretB32);
  for (let w = -window; w <= window; w++) {
    if (safeEqualStr(hotp(key, counter + w), c)) return true;
  }
  return false;
}

/* ─── Sessions signées (HMAC-SHA256) — clé = token admin ───────────────── */
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBuf(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(t, "base64");
}

export function signSession(key, { ttlSec = 43200, nowMs = Date.now() } = {}) {
  const body = { v: 1, exp: Math.floor(nowMs / 1000) + ttlSec };
  const p = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(createHmac("sha256", String(key)).update(p).digest());
  return p + "." + sig;
}

export function verifySession(token, key, { nowMs = Date.now() } = {}) {
  if (typeof token !== "string" || token.indexOf(".") === -1) return null;
  const [p, sig] = token.split(".");
  const expSig = b64url(createHmac("sha256", String(key)).update(p).digest());
  if (!safeEqualStr(sig, expSig)) return null;
  let body;
  try { body = JSON.parse(b64urlToBuf(p).toString("utf8")); } catch { return null; }
  if (!body || typeof body.exp !== "number" || body.exp < Math.floor(nowMs / 1000)) return null;
  return body;
}

/* ─── Codes de secours (usage unique, stockés hashés) ──────────────────── */
const BCAL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* lisibles, sans I/O/0/1 */
export const normalizeCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashBackup = (c) => createHash("sha256").update(normalizeCode(c)).digest("hex");

export function generateBackupCodes(n = 8) {
  const one = () => Array.from({ length: 8 }, () => BCAL[randomInt(BCAL.length)]).join("");
  return Array.from({ length: n }, () => {
    const raw = one();
    return raw.slice(0, 4) + "-" + raw.slice(4);
  });
}

/* Renvoie {ok, hashes} : si `code` correspond à un hash, il est CONSOMMÉ
   (retiré de la liste). `hashes` est la nouvelle liste à persister. */
export function consumeBackup(code, hashes = []) {
  const h = hashBackup(code);
  const idx = (hashes || []).findIndex((x) => safeEqualStr(x, h));
  if (idx === -1) return { ok: false, hashes };
  const next = hashes.slice();
  next.splice(idx, 1);
  return { ok: true, hashes: next };
}

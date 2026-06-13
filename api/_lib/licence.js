/**
 * Licences Lucens — logique métier (stockage Vercel KV).
 *
 * Ce fichier est un HELPER (_lib), PAS une route → il ne compte pas dans la
 * limite de 12 fonctions serverless du plan Hobby. Les fonctions reçoivent `kv`
 * en 1er argument : appelées avec `import { kv } from '@vercel/kv'` côté routes,
 * et avec un mock en mémoire côté tests.
 *
 * Règles :
 *   - 1 code = 1 date d'expiration (modifiable par l'admin).
 *   - 1 appareil actif, « le dernier l'emporte » : le binding se fait à
 *     l'ACTIVATION (Réglages). L'analyse VÉRIFIE la correspondance (pas de
 *     rebind silencieux) → un autre appareil est refusé tant qu'il n'a pas
 *     ré-activé.
 *   - Expiration calculée sur l'horloge SERVEUR (jamais celle du client).
 *   - Révocation immédiate (appliquée à la prochaine analyse).
 */

import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* sans I,O,0,1 ambigus */
const norm = (c) => String(c || "").trim().toUpperCase();
const K = (c) => `licence:${norm(c)}`;
const INDEX = "licence:index";

export function generateCode() {
  /* V328 — codes raccourcis : 2 groupes de 4 (8 caractères aléatoires, alphabet
     31 sans I/O/0/1) → ex. LUCENS-7QK2-9F3A. ~41 bits : largement inguessable,
     surtout avec la limitation anti-essais sur l'activation. */
  const grp = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `LUCENS-${grp()}-${grp()}`;
}

export async function getLicence(kv, code) {
  const raw = await kv.get(K(code));
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function save(kv, lic) {
  await kv.set(K(lic.code), JSON.stringify(lic));
  await kv.sadd(INDEX, norm(lic.code));
}

export async function createLicence(kv, { nom, prenom, email, entreprise, numeroCommande, expiresAt } = {}) {
  let code = generateCode();
  while (await getLicence(kv, code)) code = generateCode();
  const now = new Date().toISOString();
  const lic = {
    code,
    nom: nom || "",
    prenom: prenom || "",
    email: email || "",
    entreprise: entreprise || "",
    numeroCommande: numeroCommande || "",
    expiresAt: expiresAt || "",
    statut: "active",
    deviceId: null,
    createdAt: now,
    activatedAt: null,
  };
  await save(kv, lic);
  return lic;
}

/* Activation (Réglages) : lie l'appareil — « dernier l'emporte ». Renvoie le statut. */
export async function activate(kv, code, deviceId, now = new Date()) {
  const lic = await getLicence(kv, code);
  if (!lic) return { ok: false, reason: "unknown" };
  if (lic.statut === "revoked") return { ok: false, reason: "revoked" };
  if (!lic.expiresAt || new Date(lic.expiresAt) <= now) return { ok: false, reason: "expired", expiresAt: lic.expiresAt };
  lic.deviceId = deviceId;
  if (!lic.activatedAt) lic.activatedAt = now.toISOString();
  await save(kv, lic);
  return { ok: true, expiresAt: lic.expiresAt, activatedAt: lic.activatedAt };
}

/* Analyse : vérifie SANS rebind. L'appareil doit correspondre au lié. */
export async function checkForAnalysis(kv, code, deviceId, now = new Date()) {
  const lic = await getLicence(kv, code);
  if (!lic) return { ok: false, reason: "unknown" };
  if (lic.statut === "revoked") return { ok: false, reason: "revoked" };
  if (!lic.expiresAt || new Date(lic.expiresAt) <= now) return { ok: false, reason: "expired" };
  if (!lic.deviceId || lic.deviceId !== deviceId) return { ok: false, reason: "device" };
  return { ok: true, expiresAt: lic.expiresAt };
}

export async function updateLicence(kv, code, patch = {}) {
  const lic = await getLicence(kv, code);
  if (!lic) return null;
  const allow = ["nom", "prenom", "email", "entreprise", "numeroCommande", "expiresAt", "statut", "deviceId"];
  for (const k of allow) if (k in patch) lic[k] = patch[k];
  await save(kv, lic);
  return lic;
}

export const revoke = (kv, code) => updateLicence(kv, code, { statut: "revoked" });
export const unbindDevice = (kv, code) => updateLicence(kv, code, { deviceId: null });

export async function removeLicence(kv, code) {
  await kv.del(K(code));
  await kv.srem(INDEX, norm(code));
}

export async function listLicences(kv) {
  const codes = await kv.smembers(INDEX);
  const out = [];
  for (const c of codes) {
    const l = await getLicence(kv, c);
    if (l) out.push(l);
  }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

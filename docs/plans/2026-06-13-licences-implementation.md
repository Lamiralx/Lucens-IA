# Système de licences Lucens — Plan d'implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verrouiller l'analyse derrière un code de licence à durée, géré entièrement dans les Réglages côté client et via une page admin protégée — sans créer de nouvelle fonction serverless ni rien changer à l'interface hors Réglages.

**Architecture:** Source de vérité = Vercel KV. Toute la logique vit dans un helper `api/_lib/licence.js` (pas une route → ne compte pas dans la limite 12 fonctions). Le client parle au serveur via des `mode=` repliés dans `/api/analyze` (comme `mode=translate` existant). L'admin passe par des `action=` repliées dans `api/lucens-stats.js` (déjà protégé par `x-lucens-admin`). Une page statique `admin-licences.html` consomme cet endpoint.

**Tech Stack:** Node serverless (Vercel), `@vercel/kv`, `node:crypto`, HTML/JS vanilla (index.html monolithe, CRLF), i18n maison `I18N{fr,en,es,de}`, SW versionné.

**Contraintes gravées :**
- 12 fonctions serverless = plafond Hobby DÉJÀ atteint → **interdiction d'ajouter un fichier route dans `api/`**. On replie dans `analyze.js`, `lucens-stats.js`, et un `_lib`.
- Périmètre UI strict : **la licence n'apparaît QUE dans les Réglages**. Accueil/analyse inchangés. Le refus d'analyse réutilise le mécanisme d'erreur existant.
- Validation **toujours côté serveur**, horloge **serveur**, **fail-closed** (si KV indisponible → refuser, ne pas offrir d'analyses gratuites).
- Modèle device : binding à l'**activation** (Réglages), « dernier l'emporte ». L'analyse VÉRIFIE la correspondance (pas de rebind silencieux).

---

## Modèle de données (KV)

```
licence:{CODE}          → JSON { code, nom, prenom, email, entreprise, numeroCommande,
                                  expiresAt (ISO), statut: "active"|"revoked",
                                  deviceId|null, createdAt (ISO), activatedAt (ISO|null) }
licence:index           → Set de tous les CODE (pour lister côté admin)
```
CODE = `LUCENS-XXXX-XXXX-XXXX`, alphabet sans caractères ambigus, stocké/saisi en MAJ.

---

### Task 0 : Préparation

**Steps**
1. Vérifier la branche : `git status` (on travaille sur `v37`). Pas de worktree dédié requis.
2. Confirmer le plafond fonctions : `ls api/*.js | wc -l` → doit afficher `12`. Si on dépasse 12, STOP (le déploiement échouera). Tout ce plan replie dans l'existant → on reste à 12.
3. Confirmer KV branché : `vercel env ls` doit lister `KV_REST_API_URL` (déjà vu).
4. Commit point de départ (rien à committer, juste repère).

---

### Task 1 : Helper `api/_lib/licence.js` (cœur logique)

**Files:**
- Create: `api/_lib/licence.js`
- Test:   `.claude/tests/licence-unit.mjs` (gitignored, KV mocké en mémoire)

**Step 1 — Écrire le test qui échoue** (`.claude/tests/licence-unit.mjs`)

```js
// Mock @vercel/kv en mémoire AVANT d'importer le helper.
import { mock } from 'node:test';
const store = new Map();
const kvMock = {
  get: async (k) => store.has(k) ? store.get(k) : null,
  set: async (k, v) => { store.set(k, v); },
  del: async (k) => { store.delete(k); },
  sadd: async (k, m) => { const s = store.get(k) || new Set(); s.add(m); store.set(k, s); },
  srem: async (k, m) => { const s = store.get(k); if (s) s.delete(m); },
  smembers: async (k) => Array.from(store.get(k) || []),
};
// Injection : on importe via un loader qui remplace @vercel/kv.
// Plus simple ici : exposer les fns en passant `kv` en paramètre (voir impl).

import * as L from '../../api/_lib/licence.js';

const NOW = new Date('2026-06-14T10:00:00Z');
function reset(){ store.clear(); }

async function run(){
  // 1. créer + valider sur 1er appareil
  reset();
  const c = await L.createLicence(kvMock, { email:'a@b.fr', expiresAt:'2027-06-14T00:00:00Z' });
  console.assert(/^LUCENS-/.test(c.code), 'code format');
  let v = await L.activate(kvMock, c.code, 'dev-1', NOW);
  console.assert(v.ok === true, '1re activation OK');
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-1', NOW);
  console.assert(v.ok === true, 'analyse même appareil OK');

  // 2. autre appareil refusé à l'analyse (pas de rebind silencieux)
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-2', NOW);
  console.assert(v.ok === false && v.reason === 'device', 'autre appareil refusé en analyse');

  // 3. réactivation = dernier l'emporte
  await L.activate(kvMock, c.code, 'dev-2', NOW);
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-2', NOW);
  console.assert(v.ok === true, 'dev-2 actif après réactivation');
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-1', NOW);
  console.assert(v.ok === false, 'dev-1 délié');

  // 4. expiration (horloge serveur)
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-2', new Date('2027-06-15T00:00:00Z'));
  console.assert(v.ok === false && v.reason === 'expired', 'expiré refusé');

  // 5. révocation immédiate
  await L.revoke(kvMock, c.code);
  v = await L.checkForAnalysis(kvMock, c.code, 'dev-2', NOW);
  console.assert(v.ok === false && v.reason === 'revoked', 'révoqué refusé');

  console.log('OK licence-unit');
}
run();
```

> Note d'impl : pour rendre le helper testable sans loader, **les fonctions prennent `kv` en 1er argument**. Dans `analyze.js`/`lucens-stats.js` on appellera `import { kv } from '@vercel/kv'` et on passera `kv`.

**Step 2 — Lancer, vérifier l'échec**
Run: `node .claude/tests/licence-unit.mjs`
Expected: erreur « Cannot find module ../../api/_lib/licence.js ».

**Step 3 — Implémenter `api/_lib/licence.js`**

```js
import { randomInt } from "node:crypto";

const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const norm = (c) => String(c || "").trim().toUpperCase();
const K = (c) => `licence:${norm(c)}`;
const INDEX = "licence:index";

export function generateCode() {
  const grp = () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join("");
  return `LUCENS-${grp()}-${grp()}-${grp()}`;
}

export async function getLicence(kv, code) {
  const raw = await kv.get(K(code));
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function save(kv, lic) {
  await kv.set(K(lic.code), JSON.stringify(lic));
  await kv.sadd(INDEX, lic.code);
}

export async function createLicence(kv, { nom, prenom, email, entreprise, numeroCommande, expiresAt }) {
  let code = generateCode();
  while (await getLicence(kv, code)) code = generateCode();
  const now = new Date().toISOString();
  const lic = {
    code, nom: nom||"", prenom: prenom||"", email: email||"",
    entreprise: entreprise||"", numeroCommande: numeroCommande||"",
    expiresAt, statut: "active", deviceId: null, createdAt: now, activatedAt: null,
  };
  await save(kv, lic);
  return lic;
}

// Activation (Réglages) : lie l'appareil, « dernier l'emporte ». Renvoie le statut.
export async function activate(kv, code, deviceId, now = new Date()) {
  const lic = await getLicence(kv, code);
  if (!lic) return { ok: false, reason: "unknown" };
  if (lic.statut === "revoked") return { ok: false, reason: "revoked" };
  if (new Date(lic.expiresAt) <= now) return { ok: false, reason: "expired", expiresAt: lic.expiresAt };
  lic.deviceId = deviceId;
  if (!lic.activatedAt) lic.activatedAt = now.toISOString();
  await save(kv, lic);
  return { ok: true, expiresAt: lic.expiresAt, activatedAt: lic.activatedAt };
}

// Analyse : vérifie SANS rebind. L'appareil doit correspondre au lié.
export async function checkForAnalysis(kv, code, deviceId, now = new Date()) {
  const lic = await getLicence(kv, code);
  if (!lic) return { ok: false, reason: "unknown" };
  if (lic.statut === "revoked") return { ok: false, reason: "revoked" };
  if (new Date(lic.expiresAt) <= now) return { ok: false, reason: "expired" };
  if (!lic.deviceId || lic.deviceId !== deviceId) return { ok: false, reason: "device" };
  return { ok: true, expiresAt: lic.expiresAt };
}

export async function updateLicence(kv, code, patch) {
  const lic = await getLicence(kv, code);
  if (!lic) return null;
  const allow = ["nom","prenom","email","entreprise","numeroCommande","expiresAt","statut","deviceId"];
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
  for (const c of codes) { const l = await getLicence(kv, c); if (l) out.push(l); }
  return out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}
```

**Step 4 — Lancer, vérifier le succès**
Run: `node .claude/tests/licence-unit.mjs`
Expected: `OK licence-unit`, aucun `console.assert` rouge.

**Step 5 — Commit**
```
git add api/_lib/licence.js
git commit -m "feat(licence): helper KV (create/activate/check/update/revoke/list) + tests"
```

---

### Task 2 : Verrou dans `api/analyze.js`

**Files:** Modify `api/analyze.js`

**Step 1 — Import** (en tête, après les imports existants ligne ~5)
```js
import * as Licence from "./_lib/licence.js";
```

**Step 2 — Mode activation/statut** (replié comme `mode=translate`). Tout en haut du handler, AVANT le traitement d'analyse, après lecture du body :
```js
if (req.body?.mode === "licence_activate") {
  const code = (req.headers["x-lucens-licence"] || req.body.code || "").toString();
  const device = (req.headers["x-lucens-device"] || req.body.deviceId || "").toString();
  if (!device) return res.status(400).json({ ok: false, reason: "device_missing" });
  let r;
  try { r = await Licence.activate(kv, code, device); }
  catch (e) { return res.status(503).json({ ok: false, reason: "kv_unavailable" }); }
  return res.status(r.ok ? 200 : 403).json(r);
}
```

**Step 3 — Gate de l'analyse réelle.** Juste APRÈS le rate-limit (analyze.js ~ligne 1040, après `if (!rl.ok) return send429(...)`), AVANT toute préparation d'appel Gemini :
```js
const licCode = (req.headers["x-lucens-licence"] || "").toString();
const licDevice = (req.headers["x-lucens-device"] || "").toString();
let lic;
try { lic = await Licence.checkForAnalysis(kv, licCode, licDevice); }
catch (e) { return res.status(503).json({ error: "Licence non vérifiable (service indisponible).", type: "LicenceError", reason: "kv_unavailable" }); }
if (!lic.ok) {
  return res.status(403).json({ error: "Licence requise ou invalide.", type: "LicenceError", reason: lic.reason });
}
```
> **fail-closed** : toute erreur KV → 403/503, jamais d'appel Gemini.

**Step 4 — Test d'intégration léger** (`.claude/tests/licence-gate.mjs`) : démarrer `vercel dev` OU tester en mockant `req/res` + le helper. Minimal : appeler le handler exporté avec un faux `req` sans licence → attendre 403 `LicenceError`. (Si trop lourd, vérification manuelle via curl après déploiement Task 7.)

**Step 5 — Commit**
```
git add api/analyze.js
git commit -m "feat(licence): gate serveur /api/analyze (mode activate + check, fail-closed)"
```

---

### Task 3 : Admin CRUD replié dans `api/lucens-stats.js`

**Files:** Modify `api/lucens-stats.js`

**Step 1 — Import** `import * as Licence from "./_lib/licence.js";` + `import { kv } from "@vercel/kv";` (si absent).

**Step 2 — Après la vérif `x-lucens-admin` existante (≈ligne 61)**, router sur `req.body.action` (POST) :
```js
const action = req.body?.action;
if (action?.startsWith("licence_")) {
  try {
    if (action === "licence_create") return res.json(await Licence.createLicence(kv, req.body.data || {}));
    if (action === "licence_list")   return res.json({ items: await Licence.listLicences(kv) });
    if (action === "licence_update") return res.json(await Licence.updateLicence(kv, req.body.code, req.body.patch || {}));
    if (action === "licence_revoke") return res.json(await Licence.revoke(kv, req.body.code));
    if (action === "licence_unbind") return res.json(await Licence.unbindDevice(kv, req.body.code));
    if (action === "licence_delete") { await Licence.removeLicence(kv, req.body.code); return res.json({ ok: true }); }
  } catch (e) { return res.status(500).json({ error: String(e?.message || e) }); }
}
```
> Vérifier que l'endpoint lit bien le body JSON (méthode POST). Ajouter `applyCors`/parsing si besoin, en s'alignant sur les autres endpoints admin.

**Step 3 — Test** : `curl -X POST .../api/lucens-stats -H "x-lucens-admin: <token>" -H "content-type: application/json" -d '{"action":"licence_create","data":{"email":"x@y.fr","expiresAt":"2027-06-14T00:00:00Z"}}'` → renvoie un `code`. Puis `licence_list` le retrouve. (Après déploiement Task 7, ou via `vercel dev`.)

**Step 4 — Commit**
```
git add api/lucens-stats.js
git commit -m "feat(licence): actions admin (create/list/update/revoke/unbind/delete) repliées dans lucens-stats"
```

---

### Task 4 : Page admin statique `admin-licences.html`

**Files:** Create `admin-licences.html` (racine ; fichier statique → PAS une fonction)

**Spec** (reproduire la maquette validée) :
- Champ « Token admin » en haut → stocké en `sessionStorage` ; envoyé en header `x-lucens-admin` sur chaque appel `POST /api/lucens-stats`.
- Formulaire **Créer** : Nom, Prénom, Email, Entreprise, N° de commande, Date d'expiration → `action: licence_create` → affiche le code généré + bouton copier.
- **Liste** (`action: licence_list`) : Code (+ icône appareil lié), Client (nom + email), Expire, Statut (actif/expiré calculé/révoqué), actions **Modifier** (form pré-rempli → `licence_update`), **Révoquer** (`licence_revoke`), **Délier appareil** (`licence_unbind`), **Supprimer** (`licence_delete`).
- Style aligné Lucens (pétrole #0F3D4E, cuivre #B54A2A) mais autonome ; aucune dépendance.

**Steps :** créer la page → tester en local (ouvrir le fichier, coller le token, créer/lister) → commit.
```
git add admin-licences.html
git commit -m "feat(licence): page admin statique de gestion des codes"
```

---

### Task 5 : Réglages côté client (index.html) — bloc Licence

**Files:** Modify `index.html` (panneau Réglages ~8882) + dict I18N (fr/en/es/de)

**Spec :**
- Ajouter un groupe « Licence » dans `#settingsOverlay` (après le groupe Langue ~8893), avec :
  - `data-i18n="settings_licence"` (titre groupe).
  - Champ input `#licenceInput` + bouton `#licenceActivate` (`data-i18n="licence_activate"`).
  - Zone statut `#licenceStatus` (cachée tant qu'inconnu) affichant **uniquement** : « Active · valable du {activatedAt} au {expiresAt} » / « Expirée le {expiresAt} » / « Aucun code ».
- `deviceId` : générer une fois via `crypto.randomUUID()`, persister en `localStorage('lucens_device')`. Code en `localStorage('lucens_licence')`.
- `#licenceActivate` → `POST /api/analyze {mode:'licence_activate'}` avec headers `x-lucens-licence`, `x-lucens-device` → maj `#licenceStatus` + stockage local.
- Nouvelles clés i18n (×4 langues) : `settings_licence`, `licence_activate`, `licence_placeholder`, `licence_active`, `licence_expired`, `licence_none`, `licence_valid_until`, `licence_activated_on`.
- **RIEN ailleurs** : aucune modif accueil/analyse.

**Steps :** éditer DOM Réglages → ajouter les 8 clés × 4 langues → vérifier parité i18n (`node .claude/tests/_verify-index-i18n.mjs`) → vérif rendu navigateur (Réglages, 3 états via mock) → commit.
```
git add index.html
git commit -m "feat(licence): bloc Licence dans les Réglages (saisie + statut 2 dates) + i18n 4 langues"
```

---

### Task 6 : Brancher les appels d'analyse (index.html)

**Files:** Modify `index.html` (fetch `/api/analyze` ~21915 et ~22175)

**Spec :**
- Ajouter aux 2 `fetch('/api/analyze', {...})` d'analyse réelle les headers :
  `'x-lucens-licence': localStorage.getItem('lucens_licence')||''`, `'x-lucens-device': localStorage.getItem('lucens_device')||''`.
- Gérer la réponse **403 `type:LicenceError`** via le **mécanisme d'erreur DÉJÀ existant** (le même chemin qui affiche les erreurs d'analyse). Message i18n court « Licence requise — activez votre code dans les Réglages » (clé `licence_required_msg` ×4). **Ne rien ajouter à l'accueil.**
- `mode=translate` (~14030) : NE PAS gater (laisser libre, c'est de la traduction d'UI).

**Steps :** repérer le handler d'erreur d'analyse existant (chercher où le `type`/`error` de la réponse est affiché) → y ajouter le cas LicenceError → ajouter la clé i18n ×4 → test → commit.
```
git add index.html
git commit -m "feat(licence): analyses envoient code+device, refus géré par le canal d'erreur existant"
```

---

### Task 7 : SW bump, déploiement, vérif E2E

**Steps :**
1. Bump `sw.js` `CACHE_VERSION` (v325 → v326). Commit.
2. Déployer : `vercel --prod --yes` ; vérifier `curl .../sw.js | grep lucens-v326`.
3. E2E réel :
   - Admin : créer un code (curl ou page admin) → noté.
   - Sans licence : `curl -X POST .../api/analyze ...` (image bidon) → **403 LicenceError**.
   - Activer le code (mode licence_activate) → 200 + dates.
   - Analyse avec code+device lié → passe (200).
   - Analyse avec un autre device → 403 reason `device`.
   - Révoquer (admin) → analyse suivante 403 reason `revoked`.
4. Sur device : vérifier Réglages affiche les 2 dates, l'analyse marche, et qu'aucune licence n'apparaît ailleurs.
5. Mémoire : créer une note `lucens_licences.md` (archi + clé KV + endpoints repliés + page admin) et l'indexer dans MEMORY.md.

---

## Points à trancher pendant l'exécution
- **fail-closed** confirmé (refus si KV down). Si l'utilisateur préfère ne jamais bloquer un client payant lors d'une panne KV, basculer en fail-open (1 ligne) — décision produit.
- Format/parsing du body POST de `lucens-stats.js` à aligner sur les autres endpoints admin (vérifier qu'il lit déjà `req.body`).
- Vérifier que `mode=translate` et les autres usages de `/api/analyze` ne sont pas cassés par l'ajout du gate (le gate est APRÈS le bloc `mode`).

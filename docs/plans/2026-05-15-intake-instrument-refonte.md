# Intake Instrument Refonte — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refonte de l'écran intake de Lucens IA en "instrument card" (status bar + viewfinder unique + micro-stats + foot rail) tout en préservant le moteur d'analyse, le flow utilisateur, et le design system existant (Plex Sans/Mono, terra cotta, surfaces sombres).

**Architecture:** SPA HTML/CSS/JS monolithique (~13 000 lignes dans `index.html`). Refonte localisée à la section `#uploadHub` et à ses styles. Les IDs JS critiques (`dropzone`, `cameraBtn`, `galleryBtn`, `intakeHelpBtn`) sont préservés pour ne pas casser les listeners. Un module JS `InstrumentStats` est ajouté pour la télémétrie locale (localStorage uniquement). Le module `LucensContext` (déjà existant) expose déjà `open()` — pas à toucher.

**Tech Stack:** HTML5, CSS variables custom, Vanilla JS ES6+ (IIFE patterns), localStorage. Pas de framework, pas de bundler — l'app est un seul fichier statique servi par Vercel.

**Design Doc:** `docs/plans/2026-05-15-intake-instrument-refonte-design.md`

**Validation Strategy:** Le projet n'a pas de tests automatisés. Chaque étape inclut un check manuel précis (DOM inspection, console, comportement visible) avant validation. Test environnement : ouvrir `index.html` en local dans Chrome avec DevTools, OU déploiement preview Vercel.

---

## Task 1 — Foundation : DOM + CSS du squelette mort

**Objectif :** Poser le nouveau DOM `.instrument` à côté de l'ancien, masqué par `display:none`, avec toutes les CSS `.inst-*` complètes. Aucun JS branché. Permet validation visuelle isolée.

**Files:**
- Modify: `C:\Users\Lamiralx\OneDrive\APP biofilm\index.html`
  - CSS additions vers la fin du `<style>` (avant `</style>`)
  - HTML insertion juste après la ligne 5295 (`</header>`), avant `<main>` ouvert ligne 5298

### Step 1.1 — Insérer le bloc CSS `.instrument` et enfants

**Action :** Ajouter le bloc CSS suivant juste avant la fermeture `</style>` du document.

**Repère pour localiser l'insertion :** rechercher `</style>` dans `index.html`. Insérer le bloc CSS ci-dessous JUSTE AVANT cette balise fermante.

```css
/* ═══════════════════════════════════════════════════════════════════════════
   INSTRUMENT CARD — refonte intake (2026-05-15)
   Cf. docs/plans/2026-05-15-intake-instrument-refonte-design.md
   ─────────────────────────────────────────────────────────────────────────── */

.instrument {
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  padding: clamp(20px, 4vw, 28px) clamp(16px, 3vw, 24px);
  background: var(--surface-low);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  position: relative;
  isolation: isolate;
}

/* ─── A. STATUS BAR ─── */
.inst-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 32px;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--hairline);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
}
.inst-status-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.inst-status-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.inst-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--risk-low, #6FCF8E);
  box-shadow: 0 0 0 2px rgba(111, 207, 142, 0.16);
  animation: instDotPulse 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
.inst-dot.is-warn  { background: #E8C16A; box-shadow: 0 0 0 2px rgba(232, 193, 106, 0.18); animation: none; }
.inst-dot.is-error { background: #E85A4A; box-shadow: 0 0 0 2px rgba(232, 90, 74, 0.18); animation: none; }
@keyframes instDotPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .inst-dot { animation: none; }
}
.inst-app {
  color: var(--ink-primary);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.inst-sep { color: var(--ink-tertiary); }
.inst-meta { color: var(--ink-secondary); }

.inst-sector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px 0 10px;
  background: var(--surface-mid);
  border: 1px solid var(--hairline-hi, var(--hairline));
  border-left: 2px solid var(--terra, #D84315);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--motion-fast) var(--ease-out);
}
.inst-sector:hover { background: var(--surface-hi, var(--surface-mid)); }
.inst-sector.is-empty { color: var(--ink-tertiary); border-left-color: var(--ink-tertiary); }
.inst-sector-chev { width: 8px; height: 5px; opacity: 0.6; }

.inst-help {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--hairline);
  color: var(--ink-secondary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
}
.inst-help:hover { border-color: var(--ink-primary); color: var(--ink-primary); }
.inst-help svg { width: 14px; height: 14px; }

/* ─── B. VIEWFINDER ─── */
.inst-viewfinder {
  position: relative;
  flex: 1;
  min-height: clamp(360px, 60vh, 460px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: clamp(20px, 4vw, 32px);
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  isolation: isolate;
}
.inst-corner {
  position: absolute;
  width: 18px; height: 18px;
  border: 1px solid var(--ink-secondary);
  pointer-events: none;
  transition: border-color var(--motion-fast) var(--ease-out), transform 180ms var(--ease-out);
}
.inst-corner--tl { top: 0; left: 0; border-right: 0; border-bottom: 0; }
.inst-corner--tr { top: 0; right: 0; border-left: 0; border-bottom: 0; }
.inst-corner--bl { bottom: 0; left: 0; border-right: 0; border-top: 0; }
.inst-corner--br { bottom: 0; right: 0; border-left: 0; border-top: 0; }

@media (hover: hover) and (pointer: fine) {
  .inst-viewfinder:hover .inst-corner { border-color: var(--ink-primary); }
}
.inst-viewfinder.drag-over .inst-corner {
  border-color: var(--accent-hi, var(--terra));
  transform: translate(0,0);
}
.inst-viewfinder.drag-over .inst-corner--tl { transform: translate( 2px,  2px); }
.inst-viewfinder.drag-over .inst-corner--tr { transform: translate(-2px,  2px); }
.inst-viewfinder.drag-over .inst-corner--bl { transform: translate( 2px, -2px); }
.inst-viewfinder.drag-over .inst-corner--br { transform: translate(-2px, -2px); }

.inst-icon {
  width: 40px; height: 40px;
  color: var(--ink-tertiary);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: var(--space-2);
  transition: color var(--motion-fast) var(--ease-out);
}
.inst-icon svg { width: 100%; height: 100%; }
@media (hover: hover) and (pointer: fine) {
  .inst-viewfinder:hover .inst-icon { color: var(--accent-hi, var(--terra)); }
}
.inst-viewfinder.drag-over .inst-icon { color: var(--accent-hi, var(--terra)); }

.inst-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 64px;
  min-width: 200px;
  padding: 0 24px;
  background: var(--ink-primary);
  color: var(--surface-page);
  border: 0;
  border-radius: var(--radius-sm);
  font-family: var(--font-display, var(--font-sans));
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 120ms var(--ease-out), box-shadow 120ms var(--ease-out), background 120ms var(--ease-out);
}
@media (min-width: 720px) {
  .inst-cta { min-width: 240px; }
}
@media (hover: hover) and (pointer: fine) {
  .inst-cta:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  }
}
.inst-cta:active { transform: translateY(0); }
.inst-cta svg { width: 18px; height: 18px; }

.inst-alt {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 0;
  color: var(--ink-secondary);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 4px;
  text-decoration-color: var(--hairline-hi, var(--hairline));
  padding: 6px 4px;
  -webkit-tap-highlight-color: transparent;
  transition: color var(--motion-fast) var(--ease-out), text-decoration-color var(--motion-fast) var(--ease-out);
}
.inst-alt:hover { color: var(--ink-primary); text-decoration-color: var(--ink-primary); }
.inst-alt svg { width: 12px; height: 12px; }

/* ─── C. MICRO-STATS ─── */
.inst-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: var(--space-3);
  border-top: 1px solid var(--hairline);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-tertiary);
  letter-spacing: 0.02em;
}
.inst-stats.is-empty { display: none; }
.inst-stat b { color: var(--ink-primary); font-weight: 600; }
.inst-stat-sep { opacity: 0.45; }

/* ─── D. FOOT RAIL ─── */
.inst-foot {
  display: flex;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-tertiary);
  opacity: 0.45;
  letter-spacing: 0.04em;
  margin-top: 4px;
}

/* ─── Responsive ─── */
@media (max-width: 720px) {
  .instrument { gap: var(--space-3); }
  .inst-viewfinder { min-height: calc(100dvh - 200px); }
  .inst-cta { min-width: 180px; height: 60px; font-size: 14px; }
}
@media (max-width: 360px) {
  .inst-sector-label { display: none; }
  .inst-sector { padding: 0 6px; }
}
```

**Vérification 1.1 :**
- Ouvrir `index.html` dans le navigateur
- Console DevTools : pas d'erreur CSS
- Aucun changement visuel encore (le DOM n'a pas encore le bloc `.instrument`)

### Step 1.2 — Insérer le DOM `.instrument` masqué juste après `</header>`

**Action :** Localiser dans `index.html` la ligne `</header>` qui ferme le header principal (ligne ~5296), et insérer juste après (avant le `<main>` ligne ~5298) le bloc HTML ci-dessous.

```html
<!-- INSTRUMENT CARD — refonte intake (squelette mort, activé en Step 2.x) -->
<div id="instrumentPreview" style="display:none; padding: var(--space-8) 0;">
  <section class="instrument">

    <header class="inst-status">
      <div class="inst-status-left">
        <span class="inst-dot" id="instDotPreview" aria-hidden="true"></span>
        <span class="inst-app">LUCENS IA</span>
        <span class="inst-sep">·</span>
        <span class="inst-meta">UV-A 365 nm</span>
      </div>
      <div class="inst-status-right">
        <button class="inst-sector is-empty" type="button">
          <span class="inst-sector-label">NON CONFIGURÉ</span>
          <svg class="inst-sector-chev" viewBox="0 0 12 8" fill="none">
            <path d="M1 1.5 L6 6 L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="inst-help" type="button" aria-label="Aide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="inst-viewfinder">
      <span class="inst-corner inst-corner--tl"></span>
      <span class="inst-corner inst-corner--tr"></span>
      <span class="inst-corner inst-corner--bl"></span>
      <span class="inst-corner inst-corner--br"></span>

      <div class="inst-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="20" cy="48" r="14" fill="currentColor" opacity="0.06"/>
          <circle cx="20" cy="48" r="9" fill="currentColor" opacity="0.10"/>
          <circle cx="20" cy="48" r="5" fill="currentColor" opacity="0.20"/>
          <rect x="18" y="18" width="4" height="30" fill="currentColor"/>
          <rect x="18" y="44" width="32" height="4" fill="currentColor"/>
          <circle cx="20" cy="14" r="3.5" fill="currentColor"/>
        </svg>
      </div>

      <button class="inst-cta" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>SHOOT</span>
      </button>

      <button class="inst-alt" type="button">
        Importer une image
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4"/>
        </svg>
      </button>
    </div>

    <div class="inst-stats">
      <span class="inst-stat"><b>—</b> scans aujourd'hui</span>
      <span class="inst-stat-sep">·</span>
      <span class="inst-stat">dernier <b>—</b></span>
      <span class="inst-stat-sep">·</span>
      <span class="inst-stat">zone <b>—</b></span>
    </div>

    <footer class="inst-foot">
      <span>v0.4.2 · build dev</span>
    </footer>

  </section>
</div>
```

**Vérification 1.2 :**
- Ouvrir `index.html` dans le navigateur
- Aucun changement visible (encore `display:none`)
- Dans la Console : `document.getElementById('instrumentPreview').style.display = 'block'`
- Le bloc instrument doit apparaître au-dessus du `<main>`, avec toutes les zones (status bar, viewfinder avec corners, CTA SHOOT, lien alt, micro-stats, foot rail)
- Status dot doit pulser vert
- Hover desktop : corners passent en `--ink-primary`, icon en accent
- Console DevTools : aucune erreur

**Vérification visuelle attendue :**
- Card centrée, largeur ~520px desktop / pleine largeur mobile
- Status bar 32px de haut, séparateur hairline sous
- Viewfinder occupe la majorité de la hauteur, 4 corners en angles
- CTA SHOOT noire sur fond blanc inversé (texte couleur fond page), grosse
- Lien "Importer une image" sous la CTA, discret
- Micro-stats en mono 11px, séparées par `·`
- Foot rail en bas, opacité réduite

### Step 1.3 — Point de sauvegarde 1

Pas de git → sauvegarder mentalement le `index.html` (OneDrive versionne automatiquement). Noter ce qui a été ajouté :
- Bloc CSS `.instrument` + enfants
- Bloc HTML `#instrumentPreview` masqué juste après `</header>`

À ce stade, l'app de prod tourne normalement, et un preview visuel est accessible via `display:block` en console.

---

## Task 2 — Bascule : remplacer l'ancien intake par le nouveau

**Objectif :** Supprimer le contenu de `.upload-hub-content` (ancien intake) et le remplacer par la nouvelle structure `.instrument`. Préserver les IDs (`dropzone`, `cameraBtn`, `galleryBtn`, `intakeHelpBtn`). Ajouter les nouvelles clés i18n. Supprimer les CSS mortes.

### Step 2.1 — Identifier toutes les références JS aux anciens éléments

**Action :** Grep pour s'assurer qu'on ne va rien casser.

```
grep -n "intake-actions\|intake-divider\|intake-title\|intake-sub\|intake-icon\|intake-hint\|intake-corners\|hub-eyebrow\|upload-hub-content" index.html
```

**Attendu :** uniquement des occurrences CSS et HTML (pas de référence JS critique). Si une référence JS apparaît, l'inclure dans le plan de migration avant suppression.

### Step 2.2 — Remplacer la section `.upload-hub-content`

**Action :** Dans `index.html`, localiser le bloc `<section class="upload-hub" id="uploadHub">` (ligne ~5301 dans la version courante) et remplacer **tout son contenu interne** par la nouvelle structure `.instrument`. Garder l'attribut `id="uploadHub"` sur `<section>` (utilisé pour le scroll/navigation).

Bloc à remplacer (entre `<section class="upload-hub" id="uploadHub">` et son `</section>` correspondant — typiquement le bloc fini par `</section>` après le commentaire de fin de upload-hub) :

```html
<section class="upload-hub" id="uploadHub">

  <section class="instrument" aria-label="Lucens IA — Inspection UV-A">

    <header class="inst-status">
      <div class="inst-status-left">
        <span class="inst-dot" id="instDot" aria-hidden="true"></span>
        <span class="inst-app">LUCENS IA</span>
        <span class="inst-sep">·</span>
        <span class="inst-meta">UV-A 365 nm</span>
      </div>
      <div class="inst-status-right">
        <button class="inst-sector is-empty" id="sectorChip" type="button">
          <span class="inst-sector-label" id="sectorChipLabel" data-i18n="inst_no_sector">NON CONFIGURÉ</span>
          <svg class="inst-sector-chev" viewBox="0 0 12 8" fill="none" aria-hidden="true">
            <path d="M1 1.5 L6 6 L11 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="inst-help" id="intakeHelpBtn" type="button" aria-label="Aide">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </button>
      </div>
    </header>

    <div class="inst-viewfinder" id="dropzone">
      <span class="inst-corner inst-corner--tl"></span>
      <span class="inst-corner inst-corner--tr"></span>
      <span class="inst-corner inst-corner--bl"></span>
      <span class="inst-corner inst-corner--br"></span>

      <div class="inst-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none">
          <circle cx="20" cy="48" r="14" fill="currentColor" opacity="0.06"/>
          <circle cx="20" cy="48" r="9" fill="currentColor" opacity="0.10"/>
          <circle cx="20" cy="48" r="5" fill="currentColor" opacity="0.20"/>
          <rect x="18" y="18" width="4" height="30" fill="currentColor"/>
          <rect x="18" y="44" width="32" height="4" fill="currentColor"/>
          <circle cx="20" cy="14" r="3.5" fill="currentColor"/>
        </svg>
      </div>

      <button class="inst-cta" id="cameraBtn" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span data-i18n="inst_shoot">SHOOT</span>
      </button>

      <button class="inst-alt" id="galleryBtn" type="button">
        <span data-i18n="inst_alt_gallery">Importer une image</span>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4"/>
        </svg>
      </button>
    </div>

    <div class="inst-stats is-empty" id="instStats">
      <span class="inst-stat" data-key="today"><b id="instStatToday">—</b> <span data-i18n="inst_stats_today">scans aujourd'hui</span></span>
      <span class="inst-stat-sep">·</span>
      <span class="inst-stat" data-key="last"><span data-i18n="inst_stats_last">dernier</span> <b id="instStatLast">—</b></span>
      <span class="inst-stat-sep">·</span>
      <span class="inst-stat" data-key="zone"><span data-i18n="inst_stats_zone">zone</span> <b id="instStatZone">—</b></span>
    </div>

    <footer class="inst-foot">
      <span>v0.4.2 · build <span id="instBuildHash">dev</span></span>
    </footer>

  </section>

</section>
```

**Important :**
- L'`<input type="file" id="fileInput">` et l'`<input type="file" id="cameraInput" capture="environment">` doivent être **conservés** où ils étaient (généralement plus bas dans le DOM, hors `.upload-hub`). Ne PAS toucher à ces inputs.
- Si ces inputs étaient à l'intérieur de `.upload-hub-content`, les déplacer juste après le nouveau bloc `<section class="instrument">` (mais hors d'elle), avec `style="display:none"` préservé.

### Step 2.3 — Supprimer le squelette mort `#instrumentPreview` de Task 1

**Action :** Retirer le bloc `<div id="instrumentPreview" style="display:none">…</div>` inséré en Step 1.2. Il n'a plus de raison d'exister puisque le vrai intake est maintenant remplacé.

### Step 2.4 — Ajouter les nouvelles clés i18n × 4 langues

**Action :** Localiser les 4 objets de traduction (`fr`, `en`, `es`, `de`) dans `index.html`. Pour les repérer, rechercher `tab_annotated:` (présent dans chacun). Ajouter les clés suivantes dans chaque bloc :

**fr :**
```js
inst_no_sector:    "NON CONFIGURÉ",
inst_shoot:        "SHOOT",
inst_alt_gallery:  "Importer une image",
inst_stats_today:  "scans aujourd'hui",
inst_stats_last:   "dernier",
inst_stats_zone:   "zone",
inst_sector_AGRO:        "AGRO",
inst_sector_MEDICAL:     "MÉDICAL",
inst_sector_PHARMA:      "PHARMA",
inst_sector_INDUSTRIAL:  "INDUSTRIEL",
inst_sector_RESTAURATION:"RESTAURATION",
inst_sector_RESIDENTIAL: "RÉSIDENTIEL",
```

**en :**
```js
inst_no_sector:    "NO SECTOR",
inst_shoot:        "SHOOT",
inst_alt_gallery:  "Import an image",
inst_stats_today:  "scans today",
inst_stats_last:   "last",
inst_stats_zone:   "zone",
inst_sector_AGRO:        "AGRI-FOOD",
inst_sector_MEDICAL:     "MEDICAL",
inst_sector_PHARMA:      "PHARMA",
inst_sector_INDUSTRIAL:  "INDUSTRIAL",
inst_sector_RESTAURATION:"HOSPITALITY",
inst_sector_RESIDENTIAL: "RESIDENTIAL",
```

**es :**
```js
inst_no_sector:    "SIN SECTOR",
inst_shoot:        "DISPARO",
inst_alt_gallery:  "Importar una imagen",
inst_stats_today:  "análisis hoy",
inst_stats_last:   "último",
inst_stats_zone:   "zona",
inst_sector_AGRO:        "AGROALIMENTARIO",
inst_sector_MEDICAL:     "MÉDICO",
inst_sector_PHARMA:      "FARMA",
inst_sector_INDUSTRIAL:  "INDUSTRIAL",
inst_sector_RESTAURATION:"RESTAURACIÓN",
inst_sector_RESIDENTIAL: "RESIDENCIAL",
```

**de :**
```js
inst_no_sector:    "KEIN SEKTOR",
inst_shoot:        "SHOOT",
inst_alt_gallery:  "Bild importieren",
inst_stats_today:  "Analysen heute",
inst_stats_last:   "letzte",
inst_stats_zone:   "Zone",
inst_sector_AGRO:        "AGRARLEBENSMITTEL",
inst_sector_MEDICAL:     "MEDIZIN",
inst_sector_PHARMA:      "PHARMA",
inst_sector_INDUSTRIAL:  "INDUSTRIE",
inst_sector_RESTAURATION:"GASTRONOMIE",
inst_sector_RESIDENTIAL: "WOHNBEREICH",
```

**Garder** (ne PAS supprimer) les anciennes clés `upload_h1`, `upload_lead`, `intake_or`, `dropzone`, `btn_camera`, `btn_gallery` — elles peuvent être réutilisées dans l'overlay aide.

### Step 2.5 — Supprimer les CSS mortes

**Action :** Supprimer dans `index.html` les blocs CSS suivants (devenus inutiles) :
- `.upload-hub { … }` (ligne ~605)
- `.upload-hub-content { … }` et `.upload-hub-content > * { … }` (ligne ~624-637)
- `.hub-eyebrow { … }` et toutes ses variantes (ligne ~640-695)
- `.intake { … }`, `.intake::before`, `.intake::after`, `.intake-corners { … }`, `.intake.drag-over` (ligne ~698-783)
- `.intake-icon { … }` (ligne ~786-798)
- `.intake-title { … }`, `.intake-sub { … }` (ligne ~801-825)
- `.intake-actions { … }`, `.intake-actions .btn-primary`, `.intake-actions .btn-secondary` (ligne ~826-879)
- `.intake-divider`, `.intake-divider::before`, `.intake-divider::after`, `.intake-divider .intake-or` (ligne ~880+)
- `.intake-hint { … }` (probable ligne ~900-910)
- `.intake-help-trigger { … }` et `.intake-help-trigger:hover` et `.intake-help-trigger svg` (ligne ~3837-3863)

**Conserver impérativement :**
- `.intake-help-overlay`, `.intake-help-modal`, `.intake-help-hdr`, `.intake-help-eyebrow`, `.intake-help-title`, `.intake-help-close`, `.intake-help-body` → c'est l'overlay aide (V5A.1), encore actif.

### Step 2.6 — Vérification 2

**Test 1 — DOM intact :**
- Ouvrir `index.html`
- F12 → vérifier la présence de `<section class="instrument">` dans `#uploadHub`
- Vérifier IDs présents : `document.getElementById('dropzone')`, `document.getElementById('cameraBtn')`, `document.getElementById('galleryBtn')`, `document.getElementById('intakeHelpBtn')` doivent tous retourner un élément non nul

**Test 2 — Caméra :**
- Cliquer sur `SHOOT` → le picker fichier doit s'ouvrir (sur mobile, app caméra ; sur desktop, dialog fichier)
- Si rien ne se passe : vérifier que `cameraBtn.click()` déclenche `cameraInput.click()` dans le JS existant

**Test 3 — Galerie :**
- Cliquer sur "Importer une image" → file picker s'ouvre

**Test 4 — Drag&drop :**
- Glisser une image sur la zone viewfinder → classe `drag-over` doit s'appliquer, corners colorés
- Drop → upload doit démarrer normalement

**Test 5 — Aide (?) :**
- Clic sur `(?)` en haut à droite → overlay aide s'ouvre normalement

**Test 6 — i18n :**
- Changer la langue de l'app (selector langue)
- Vérifier que SHOOT / Import / scans aujourd'hui se traduisent
- Pas d'erreur console "missing translation key"

**Test 7 — Visuel :**
- Comparer avec les mockups du design doc
- Mobile : viewfinder pleine hauteur, pas de scroll inutile
- Desktop : card 520px centrée

**Test 8 — Régressions :**
- Naviguer dans toute l'app : analyse, rapport, feedback, settings
- Aucune régression visuelle ailleurs

### Step 2.7 — Point de sauvegarde 2

Sauvegarder. À ce stade :
- App fonctionnelle avec nouveau visuel intake
- Chip secteur affiche `NON CONFIGURÉ` (statique)
- Micro-stats masquées (classe `is-empty` initiale)
- Status dot pulse vert (statique)

---

## Task 3 — Chip secteur cliquable + LucensContext re-open

**Objectif :** Brancher le chip secteur sur `LucensContext`. Au load, lire l'établissement actif et afficher le label. Au clic, rouvrir le modal. Au close du modal, re-render.

**Repère :** `LucensContext.open()` existe déjà (ligne 10583, 10627). Pas besoin de l'exposer.

### Step 3.1 — Module `InstrumentSectorChip`

**Action :** Insérer un nouveau module IIFE dans la zone JS du fichier, idéalement juste après le module `LucensContext` (à repérer par `const LucensContext = (() => {`).

```js
/* ─── INSTRUMENT SECTOR CHIP ──────────────────────────────────────
   Affiche le secteur actif dans la status bar instrument et permet
   de le changer en rouvrant le modal LucensContext. */
const InstrumentSectorChip = (() => {
  const SECTOR_LABEL_KEY = {
    agro:         'inst_sector_AGRO',
    medical:      'inst_sector_MEDICAL',
    pharma:       'inst_sector_PHARMA',
    industrial:   'inst_sector_INDUSTRIAL',
    restauration: 'inst_sector_RESTAURATION',
    residential:  'inst_sector_RESIDENTIAL',
  };

  function render() {
    const chip = document.getElementById('sectorChip');
    const label = document.getElementById('sectorChipLabel');
    if (!chip || !label) return;
    let estabType = null;
    try { estabType = (typeof LucensContext !== 'undefined') ? LucensContext.get()?.establishmentType : null; } catch {}
    if (estabType && SECTOR_LABEL_KEY[estabType]) {
      const key = SECTOR_LABEL_KEY[estabType];
      label.setAttribute('data-i18n', key);
      label.textContent = (typeof t === 'function') ? t(key) : key;
      chip.classList.remove('is-empty');
    } else {
      label.setAttribute('data-i18n', 'inst_no_sector');
      label.textContent = (typeof t === 'function') ? t('inst_no_sector') : 'NON CONFIGURÉ';
      chip.classList.add('is-empty');
    }
  }

  function bind() {
    const chip = document.getElementById('sectorChip');
    if (!chip || chip._bound) return;
    chip._bound = true;
    chip.addEventListener('click', () => {
      if (typeof LucensContext !== 'undefined' && typeof LucensContext.open === 'function') {
        LucensContext.open();
      }
    });
  }

  function init() {
    bind();
    render();
    /* Observer le storage : si LucensContext save() modifie la clé, on rerender */
    window.addEventListener('storage', (e) => {
      if (e.key === 'lucens_user_context_v1') render();
    });
    /* Hook custom : LucensContext devrait dispatch un event au save. Si pas,
       on observe via MutationObserver sur le modal qui se ferme. */
    const ctxOverlay = document.getElementById('ctxOverlay');
    if (ctxOverlay) {
      const obs = new MutationObserver(() => {
        if (!ctxOverlay.classList.contains('visible')) {
          /* close du modal → on rerender */
          setTimeout(render, 50);
        }
      });
      obs.observe(ctxOverlay, { attributes: true, attributeFilter: ['class'] });
    }
  }

  return { init, render };
})();
```

### Step 3.2 — Initialiser le module au load

**Action :** Localiser la zone d'init de l'app (chercher `bindIntakeHelp()` ou `bindFeedbackModal()` — c'est dans la même zone). Ajouter juste après :

```js
if (typeof InstrumentSectorChip !== 'undefined') InstrumentSectorChip.init();
```

### Step 3.3 — Vérification 3

**Test 1 — Premier load (aucun secteur) :**
- localStorage vidé de `lucens_user_context_v1`
- Reload page → chip affiche `NON CONFIGURÉ` en gris (`is-empty`)

**Test 2 — Clic ouvre modal :**
- Cliquer sur chip → modal LucensContext s'ouvre
- Choisir "Médical" + sauver

**Test 3 — Re-render après close :**
- Modal se ferme → chip affiche `MÉDICAL` en accent terra, plus de `is-empty`

**Test 4 — Persistence :**
- Reload page → chip toujours `MÉDICAL`

**Test 5 — i18n :**
- Changer langue → label se traduit (`MEDICAL` en EN, `MÉDICO` en ES, etc.)

**Test 6 — Console clean :**
- Aucune erreur, pas de warning "LucensContext is not defined"

### Step 3.4 — Point de sauvegarde 3

---

## Task 4 — Micro-stats + status dot dynamique

**Objectif :** Brancher les micro-stats (scans du jour, last-scan, zone) sur localStorage, hooker `recordScan()` après une analyse réussie. Activer le status dot (vert prêt / ambre warn / rouge error).

### Step 4.1 — Module `InstrumentStats`

**Action :** Insérer juste après `InstrumentSectorChip` :

```js
/* ─── INSTRUMENT STATS ────────────────────────────────────────────
   Télémétrie locale (localStorage uniquement) pour la status bar :
   compteur scans du jour, last-scan time, zone courante (depuis
   LucensContext.sector). Reset compteur à minuit. */
const InstrumentStats = (() => {
  const KEY = 'lucens_instrument_stats_v1';

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { todayCount: 0, lastScanTime: null, lastZone: null, todayKey: todayStr() };
      const parsed = JSON.parse(raw);
      /* Reset si jour différent */
      if (parsed.todayKey !== todayStr()) {
        parsed.todayCount = 0;
        parsed.todayKey = todayStr();
      }
      return parsed;
    } catch {
      return { todayCount: 0, lastScanTime: null, lastZone: null, todayKey: todayStr() };
    }
  }

  function write(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
  }

  function recordScan() {
    const s = read();
    s.todayCount = (s.todayCount || 0) + 1;
    s.lastScanTime = Date.now();
    try {
      const ctx = (typeof LucensContext !== 'undefined') ? LucensContext.get() : null;
      if (ctx && ctx.sector) s.lastZone = ctx.sector;
    } catch {}
    s.todayKey = todayStr();
    write(s);
    render();
  }

  function formatHM(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function render() {
    const wrap   = document.getElementById('instStats');
    const today  = document.getElementById('instStatToday');
    const last   = document.getElementById('instStatLast');
    const zone   = document.getElementById('instStatZone');
    if (!wrap || !today || !last || !zone) return;
    const s = read();
    today.textContent = s.todayCount > 0 ? String(s.todayCount).padStart(2, '0') : '—';
    last.textContent  = formatHM(s.lastScanTime);
    zone.textContent  = s.lastZone || '—';
    const allEmpty = (s.todayCount === 0) && !s.lastScanTime && !s.lastZone;
    wrap.classList.toggle('is-empty', allEmpty);
  }

  function init() { render(); }

  return { init, recordScan, render };
})();
```

### Step 4.2 — Hooker `recordScan()` après analyse réussie

**Action :** Localiser dans `index.html` la ligne `lastResult = res;` (ligne ~13611). Insérer juste après :

```js
    /* Télémétrie locale instrument (Task 4) */
    try { if (typeof InstrumentStats !== 'undefined') InstrumentStats.recordScan(); } catch {}
```

### Step 4.3 — Module `InstrumentStatusDot`

**Action :** Insérer juste après `InstrumentStats` :

```js
/* ─── INSTRUMENT STATUS DOT ───────────────────────────────────────
   Signal de readiness en haut de la status bar.
   Vert pulsant : prêt. Ambre fixe : offline OU erreur API < 30s.
   Rouge fixe : API durablement down (≥2 timeouts consécutifs). */
const InstrumentStatusDot = (() => {
  let errTimer = null;
  let consecutiveErrors = 0;

  function setState(state) {
    const dot = document.getElementById('instDot');
    if (!dot) return;
    dot.classList.remove('is-warn', 'is-error');
    if (state === 'warn')  dot.classList.add('is-warn');
    if (state === 'error') dot.classList.add('is-error');
  }

  function applyOnlineState() {
    if (!navigator.onLine) { setState('warn'); return; }
    if (consecutiveErrors >= 2) { setState('error'); return; }
    if (errTimer) { setState('warn'); return; }
    setState('ready');
  }

  function notifyApiError() {
    consecutiveErrors++;
    if (errTimer) clearTimeout(errTimer);
    errTimer = setTimeout(() => { errTimer = null; applyOnlineState(); }, 30_000);
    applyOnlineState();
  }

  function notifyApiSuccess() {
    consecutiveErrors = 0;
    if (errTimer) { clearTimeout(errTimer); errTimer = null; }
    applyOnlineState();
  }

  function init() {
    window.addEventListener('online',  applyOnlineState);
    window.addEventListener('offline', applyOnlineState);
    applyOnlineState();
  }

  return { init, notifyApiError, notifyApiSuccess };
})();
```

### Step 4.4 — Hooker `notifyApiSuccess` / `notifyApiError`

**Action :** Dans la fonction `analyzeWithAPI` (ligne ~12754) :
- Au début du `try`, rien.
- Après un appel réussi (juste avant `return data;` ou similaire) :
  ```js
  try { if (typeof InstrumentStatusDot !== 'undefined') InstrumentStatusDot.notifyApiSuccess(); } catch {}
  ```
- Dans le `catch` ou la branche d'erreur :
  ```js
  try { if (typeof InstrumentStatusDot !== 'undefined') InstrumentStatusDot.notifyApiError(); } catch {}
  ```

**Repère exact :** chercher `async function analyzeWithAPI(` puis tracer les chemins de sortie. Placer 1 success hook + 1 error hook.

### Step 4.5 — Initialiser les deux modules

**Action :** Au même endroit que `InstrumentSectorChip.init()` :

```js
if (typeof InstrumentStats !== 'undefined') InstrumentStats.init();
if (typeof InstrumentStatusDot !== 'undefined') InstrumentStatusDot.init();
```

### Step 4.6 — Vérification 4

**Test 1 — Stats initialisation :**
- localStorage vide → bloc stats masqué (`is-empty`)

**Test 2 — Premier scan :**
- Faire une analyse complète (uploadphoto, attendre rapport)
- Retour intake → bloc stats visible : `01 scans aujourd'hui · dernier HH:MM · zone —`
- Si zone configurée dans LucensContext (champ "sector") → affiché à la place du `—`

**Test 3 — Reset jour :**
- Modifier `localStorage.getItem('lucens_instrument_stats_v1')` manuellement, changer `todayKey` à une date passée
- Reload → compteur revient à 0

**Test 4 — Status dot online/offline :**
- Console : `window.dispatchEvent(new Event('offline'))` → dot devient ambre fixe
- `window.dispatchEvent(new Event('online'))` → dot redevient vert pulsant

**Test 5 — Status dot sur erreur API :**
- Simuler une erreur d'analyse (couper le wifi ou bloquer `/api/analyze` dans DevTools Network)
- Lancer une analyse → dot devient ambre pendant 30s, puis vert si le 2e essai réussit

**Test 6 — Visuel mobile :**
- Stats lisibles ? Non débordement ? Wrap propre ?

### Step 4.7 — Point de sauvegarde 4

Déploiement Vercel : `vercel --prod` depuis le terminal du projet (ou push si configuration git-Vercel existe).

---

## Critères de done

- [ ] Task 1 : nouveau DOM `.instrument` + CSS rendus en preview (`display:block` console)
- [ ] Task 2 : intake remplacé en prod, drag&drop OK, caméra OK, galerie OK, aide OK, i18n OK
- [ ] Task 3 : chip secteur dynamique, click ouvre modal, re-render au close
- [ ] Task 4 : stats incrémentent à chaque scan, reset minuit, status dot réactif
- [ ] Aucune régression sur les autres écrans (loader, rapport, feedback, settings)
- [ ] Aucune erreur Console
- [ ] Test mobile réel : viewfinder pleine hauteur, CTA SHOOT gantable

## Validation utilisateur post-déploiement

Une fois déployé, demander au user :

1. Au premier coup d'œil, ça donne "instrument" ou encore "site web" ?
2. La chip secteur est-elle trouvable instantanément ?
3. Les micro-stats te donnent-elles une info utile, ou c'est du chrome ?
4. Sur mobile en zone (gants), la CTA SHOOT est-elle assez large ?

Réponses → on garde / ajuste / pivote AVANT d'attaquer la refonte du loader (B) puis du rapport (C).

## Hors scope (ne pas implémenter ici)

- Refonte écran loader (B) — task séparée après validation A
- Refonte rapport (C) — task séparée après validation B
- Mode plein écran "Inspection" — à reconsidérer
- Build hash auto-injecté Vercel (passe 2) — simple fallback `dev` pour MVP
- Toast click foot rail → timestamp build (passe 2)

# Intake instrument refonte — Design

**Date** : 2026-05-15
**Status** : approved (user, 4 sections validées)
**Scope** : refonte forme de l'écran intake de Lucens IA, sans toucher au fond (flow, moteur, design system tokens conservés)

## Contexte

Lucens IA est une app d'inspection UV-A 365 nm pour pros HACCP / pharma / médical / agroalimentaire, utilisée sur tablette ou téléphone en zone, parfois sous gants. Plusieurs vagues V5A précédentes (overlay help, sticky toolbar, tips contextualisés, brush anti-faux-clic) ont été perçues par l'utilisateur comme "survolées" — micro-fixes invisibles à l'œil. L'écran intake actuel reste perçu comme "site web intégré sur mobile" plutôt qu'instrument terrain.

Cette refonte cible **uniquement la forme** de l'intake : structure DOM, hiérarchie visuelle, composants. Le flow upload → analyse → rapport est inchangé. Les tokens (Plex Sans/Mono, terra cotta, surfaces sombres) sont conservés.

## Diagnostic — ce qui fait "site web"

1. Structure en landing page : eyebrow → icône → H1 marketing → sous-titre → 2 boutons + "ou" → hint → bouton aide. Sept blocs empilés, registre publicitaire.
2. H1 "Analysez votre photo UV" + sous-titre vendeur. Un instrument n'a pas de baseline commerciale, il a un état.
3. Icône UV centrale décorative qui mange la zone hero sans rien dire d'opérationnel.
4. Deux boutons primaire/secondaire avec "ou" → registre formulaire web.
5. Aucun status visible : pas de "Prêt", pas de secteur actif, pas de last-scan. L'app ne dit rien d'elle-même.
6. Bouton "Comment ça marche" stretched en bas = footer site web.

## Vision — instrument card

L'intake devient une fiche d'inspection prête à shooter :

```
┌─────────────────────────────────────────────────┐
│  ● LUCENS IA · UV-A 365nm        MÉDICAL ⌄  (?) │  status bar
├─────────────────────────────────────────────────┤
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │
│                  [icône UV]                     │
│              ┌─────────────────┐                │
│              │     SHOOT       │                │  unique CTA
│              └─────────────────┘                │
│           Importer une image →                  │  lien alt discret
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │
│                                                 │
│  03 scans · dernier 14:22 · zone : bloc 2      │  micro-stats
└─────────────────────────────────────────────────┘
                v0.4.2 · build 8a3f1
```

Principes :
- Pas de titre marketing — le verbe est sur le bouton, pas en H1
- Une seule CTA primaire ; galerie devient un lien texte alt
- Status bar instrument (nom · longueur d'onde · secteur cliquable · `?`)
- Micro-stats opérationnelles (scans jour, last-scan, zone)
- Foot rail technique discret (version + build)
- Tipo mono renforcée sur les méta
- Pas de scroll : tout dans le viewport mobile

## Système visuel

### Typographie (rôles)

| Rôle | Font | Size | Weight |
|---|---|---|---|
| Status bar | Plex Mono | 11px | 500 |
| Secteur chip | Plex Mono | 11px | 600 (upper, tracking +0.08em) |
| CTA SHOOT | Plex Sans | 15px | 600 (upper, tracking +0.10em) |
| Lien alt | Plex Sans | 13px | 500 (underline 4px offset) |
| Micro-stats | Plex Mono | 11px | 400 |
| Foot rail | Plex Mono | 10px | 400 (opacity 0.4) |

Plus aucun H1 sur l'intake. Mono = structure ; Sans = CTA seule.

### Couleurs (tokens existants réutilisés)

- Fond : `--surface-page`
- Card : `--surface-low` + hairline `--hairline`
- Corners : `--ink-secondary` repos → `--accent-hi` drag-over
- CTA SHOOT : remplissage `--ink-primary` inversé (haut contraste). Pas de terra cotta sur l'intake — terra reste réservée à la cartographie
- Status dot prêt : `--risk-low` (#6FCF8E), pulsant 1.2 Hz
- Secteur chip : `--surface-mid`, hairline, accent-line gauche 2px en `--terra` (seul rappel signature)

### Dimensions

- Card : max-width 520px (au lieu de 640px)
- Hauteur min : `clamp(440px, 70vh, 540px)` — verrouille un format viseur portrait 9:11
- Padding interne : 28px 24px (mobile 20px 16px)
- CTA SHOOT : 64px haut × 200px (mobile) / 240px (desktop)
- Corners viewfinder : 18px (vs 14px aujourd'hui)
- Status bar : 48px haut

### Iconographie

- Icône UV signature réduite à 40px (vs 56px), positionnée légèrement plus haute dans le viseur
- `(?)` aide : pastille ronde 28px en coin haut-droit de la status bar (plus de bouton stretched)
- Chevron `⌄` sur secteur chip

### Motion

- Status dot : pulse opacity 1↔0.5 à 1.2 Hz
- Drag-over : corners se contractent vers le centre +2px (180ms)
- CTA hover desktop : translateY(-1px) + box-shadow soft (120ms)
- Aucune animation gratuite

## Structure DOM

```html
<section class="instrument" id="uploadHub">
  <header class="inst-status">
    <div class="inst-status-left">
      <span class="inst-dot"></span>
      <span class="inst-app">LUCENS IA</span>
      <span class="inst-sep">·</span>
      <span class="inst-meta">UV-A 365 nm</span>
    </div>
    <div class="inst-status-right">
      <button class="inst-sector" id="sectorChip">
        <span class="inst-sector-label">MÉDICAL</span>
        <svg class="inst-sector-chev">…</svg>
      </button>
      <button class="inst-help" id="intakeHelpBtn">…(?)…</button>
    </div>
  </header>

  <div class="inst-viewfinder" id="dropzone">
    <span class="inst-corner inst-corner--tl"></span>
    <span class="inst-corner inst-corner--tr"></span>
    <span class="inst-corner inst-corner--bl"></span>
    <span class="inst-corner inst-corner--br"></span>
    <div class="inst-icon">…faisceau UV…</div>
    <button class="inst-cta" id="cameraBtn">
      <svg>…camera…</svg><span>SHOOT</span>
    </button>
    <button class="inst-alt" id="galleryBtn">
      Importer une image <svg>→</svg>
    </button>
  </div>

  <div class="inst-stats" id="instStats">
    <span class="inst-stat" data-key="today"><b>—</b> scans aujourd'hui</span>
    <span class="inst-stat-sep">·</span>
    <span class="inst-stat" data-key="last">dernier <b>—</b></span>
    <span class="inst-stat-sep">·</span>
    <span class="inst-stat" data-key="zone">zone <b>—</b></span>
  </div>

  <footer class="inst-foot">
    <span class="inst-foot-version">v0.4.2 · build <span id="instBuildHash">—</span></span>
  </footer>
</section>
```

IDs préservés (`dropzone`, `cameraBtn`, `galleryBtn`, `intakeHelpBtn`) → câblages JS existants intacts.

## Comportements

### Chip secteur (`sectorChip`)

- Au load : lit `LucensContext.get()?.establishmentType`, affiche le label uppercase
- Mapping : `agro→AGRO`, `medical→MÉDICAL`, `pharma→PHARMA`, `industrial→INDUSTRIEL`, `restauration→RESTAURATION`, `residential→RÉSIDENTIEL`, fallback `NON CONFIGURÉ`
- Click → rouvre le modal LucensContext (exposer `LucensContext.open()` si absent)
- Au close du modal → re-render du chip

### Micro-stats (`instStats`)

Nouvelle clé localStorage `lucens_instrument_stats_v1` :

```js
{
  todayCount: 3,
  lastScanTime: 1715789340000,
  lastZone: "bloc 2",
  todayKey: "2026-05-15"
}
```

- Module `InstrumentStats` : `read()`, `recordScan()`, `render()`
- `recordScan()` appelé après `analyzeWithAPI` succès
- Reset compteur jour si `todayKey` différent de la date courante
- Format : `03 scans · dernier 14:22 · zone bloc 2`
- Valeurs manquantes → `—`
- Si toutes valeurs `—` → bloc entier masqué

### Status dot (`instDot`)

- Vert pulsant par défaut (prêt)
- Ambre fixe si `navigator.onLine === false` OU erreur API récente (TTL 30s)
- Rouge fixe si KV/API durablement down (>2 timeouts)
- Signal UX uniquement, ne bloque pas l'intake

### Foot rail

- `instBuildHash` injecté au build (`process.env.VERCEL_GIT_COMMIT_SHA` côté Vercel, fallback `dev`)
- Click → toast timestamp build (passe 2 optionnelle)

### Drag&drop

- `id="dropzone"` migré sur `.inst-viewfinder` → listeners existants se rebranchent sans modification
- Classe `.drag-over` applique état coloré aux 4 corners

### États visuels viewfinder

| État | Corners | Icon | CTA |
|---|---|---|---|
| Repos | `--ink-secondary` | `--ink-tertiary` | normal |
| Hover desktop | `--ink-primary` | `--accent-hi` | translateY(-1px) |
| Drag-over | `--accent-hi` | `--accent-hi` | léger glow |
| Processing | corners contractés | spinner inline | "ANALYSE…" mono |

## Responsive

- ≥ 720px : viewfinder 520×~540px centré
- < 720px : viewfinder pleine largeur, hauteur min `calc(100dvh - header - 120px)`
- < 360px : chip secteur réduite à icône `▣` + chevron, label caché

## Plan d'exécution — 4 commits

### Commit 1 — Foundation HTML + CSS (squelette mort)

Nouvelle structure DOM `.instrument` ajoutée *à côté* de l'ancienne, masquée par `display:none`. Toutes les CSS `.inst-*` posées. Aucune logique JS. Permet validation rendu visuel via flag dev.

### Commit 2 — Bascule HTML + i18n + drag&drop

Suppression `.upload-hub-content`. Migration `id="dropzone"` sur `.inst-viewfinder`. Préservation `id="cameraBtn"`, `id="galleryBtn"`, `id="intakeHelpBtn"`. Nouvelles clés i18n (`inst_shoot`, `inst_alt_gallery`, `inst_stats_today`, `inst_stats_last`, `inst_stats_zone`, `inst_no_sector`) × 4 langues. Suppression CSS mortes (~250 lignes). À ce stade, app utilisable, chip statique, stats `—`.

### Commit 3 — Chip secteur + LucensContext re-open

Lecture `establishmentType` au load, affichage label. Click ouvre modal LucensContext (vérifier/exposer `LucensContext.open()`). Re-render au close.

### Commit 4 — Micro-stats + status dot dynamique

Module `InstrumentStats`. Hook `recordScan()` après `analyzeWithAPI` succès. Reset minuit. Status dot binding `online`/`offline` + état erreur API. Foot rail version + build hash.

## Risques et parades

| Risque | Probabilité | Parade |
|---|---|---|
| Régression i18n | Moyenne | Grep avant suppression ; garder les clés dans bundles |
| Drag&drop cassé | Élevée | Conserver `id="dropzone"` |
| `(?)` aide cassé | Élevée | Conserver `id="intakeHelpBtn"` |
| Chip ouvre rien | Moyenne | Exposer `LucensContext.open()` |
| Micro-stats vides triste | Faible | `—` partout, masquer si tout `—` |
| Build hash absent | Faible | Fallback `dev`, branche prod en passe 2 |
| SHOOT confondu avec drop | Faible | `pointer-events` propres |
| Camera mobile cassé | Élevée | Conserver `<input capture="environment">` caché |

## Hors scope

- Refonte écrans loader (B) et rapport (C) — après validation terrain de A
- Mode plein écran "Inspection" — à reconsidérer après C
- Personnalisation tips (déjà faite en V5A.2)
- Build hash auto-injecté Vercel (passe 2)

## Critères de validation (post-déploiement A)

1. Premier coup d'œil → "instrument" ou encore "site web" ?
2. Chip secteur trouvable instantanément ?
3. Micro-stats donnent info utile ou chrome ?
4. CTA SHOOT assez large sous gants mobile ?

Réponses → on garde / ajuste / pivote avant d'attaquer B.

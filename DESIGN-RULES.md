# LUCENS IA — LOI DESIGN (au pixel)

> **Statut : LOI.** Toute valeur visuelle écrite dans `index.html` doit être conforme à ce document.
> Une valeur hors-loi = un bug, au même titre qu'une exception JS.
> Version initiale : V260 (2026-06-10), issue de l'audit pixel complet (51 tailles de police,
> 39 rayons, ~326 couleurs, 87 ombres recensés AVANT normalisation).

---

## 0. Les 4 critères (rappel — directive fondamentale)

Clarté (3 s) · Sans ambiguïté · Coup d'œil (sans scroll) · Précision (chaque mot actionnable).
Tout choix visuel sert un inspecteur HACCP pressé, sur smartphone, en zone bruyante.

---

## 1. COULEURS — tokens uniquement, zéro littéral

**Interdiction absolue d'écrire un hex/rgba dans une règle CSS d'écran.**
On écrit `var(--token)`. Les seuls hex autorisés sont dans les blocs `:root`.

### Thème clair (défaut)
| Token | Valeur | Usage |
|---|---|---|
| `--accent` | `#0F3D4E` | SEULE couleur d'action (boutons, liens, états actifs, croix fermer) |
| `--accent-hi` | `#0A2C39` | hover/active de l'accent |
| `--ink-primary` | `#111827` | titres, valeurs, texte fort |
| `--ink-secondary` | `#4B5563` | prose, labels de section |
| `--ink-tertiary` | `#6B7280` | eyebrows, captions, méta |
| `--ink-dim` | `#9CA3AF` | fine print, placeholders |
| `--surface-page` | `#FFFFFF` | fond d'écran |
| `--surface-mid` | `#F7F8FA` | fonds secondaires (segmented, cartes grises) |
| `--surface-hi` | `#FFFFFF` | cartes |
| `--border` | `#E5E7EB` | bordures par défaut |
| `--border-hi` | `#D1D5DB` | bordures accentuées |
| `--risk-low` | `#2E7D32` | risque faible — UNIQUE vert d'état |
| `--risk-mid` | `#B7791F` | risque modéré — UNIQUE ambre d'état |
| `--risk-hi` | `#B42318` | risque élevé — UNIQUE rouge d'état |
| `--lucens-signature` | `#B54A2A` | cuivre : point du logo, marqueur/contour de détection. JAMAIS un état, JAMAIS un bouton |

Variantes douces (fonds/cerclages d'état) : `--risk-low-soft/edge`, `--risk-mid-soft/edge`,
`--risk-hi-soft/edge` (définies dans `:root`, rgba des valeurs ci-dessus).

### Thème sombre
Mêmes tokens, surchargés dans `:root` (base) : accent `#5AA6BC`, encres claires, surfaces `#06070A → #2A2F3D`,
risques `#6FCF8E / #E8C16A / #E85A4A`. **Aucun composant ne doit casser le thème sombre**
(= aucun fond/texte en littéral ; l'écran Résultats inclus).

### Zone HUD (Live View, toujours sombre — caméra)
Le HUD vit sur du vidéo noir, quel que soit le thème. Tokens dédiés, définis une fois :
| Token | Valeur | Usage |
|---|---|---|
| `--lv-accent` | `#5AA6BC` | actions/focus dans les overlays sombres LV |
| crosshair attente | `#FFB020` | point/croix en recherche |
| crosshair détection | `--lucens-signature` `#B54A2A` | fluorescence détectée (cohérent avec le contour carto) |
| objet neutre | `#94A3B8` | « pas une fluo » |

### Interdits définitifs (ne JAMAIS réintroduire)
`#2DD4BF` et `rgba(45,212,191,…)` (teal V0-V167) · `#D84315` (terra V0-V167) ·
`#D92D20 #E5392B #EF4444 #15803D #22C55E #34A853 #C2710C #F59E0B #F6A609` (doublons de risque) ·
toute couleur Tailwind par réflexe.

---

## 2. TYPOGRAPHIE — Inter système, 8 tailles

`--font-display` = `--font-body` = `--font-mono` = pile Inter/SF/système (V164).
**Interdit : `'IBM Plex …'`, `'Inter Tight'`, toute famille littérale.** On écrit `var(--font-…)`.

### Échelle UNIQUE (px) : `10 · 11 · 12 · 13 · 14 · 16 · 18 · 22`
(+ `24` réservé au score hero `XX/100`). **Toute taille en `.5` est interdite.**
Correspondance : 9/9.5/10.5→10 · 11.5→11 ou 12 · 12.5→12 · 13.5→13 · 14.5→14 · 15/15.5→16 (boutons héro) ou 14 · 17/19/20→18 · 21/23→22.

### Styles nommés (seuls assemblages autorisés)
| Style | Spec | Exemples |
|---|---|---|
| **Titre** | 18 / 700 / -0.01em / `ink-primary` | titres de modaux (Réglages, Contexte, Moment, Feedback, Learn), titre verdict (couleur = risque) |
| **Body** | 14 / 400–500 / 1.5 | prose, phrases des 5 blocs |
| **Body fort** | 14 / 600 | texte d'action, lignes importantes |
| **Méta** | 12 / 500 | sous-titres, hints, légendes |
| **Label de section (Résultats)** | 12 / 700 / +0.04em / UPPERCASE / `ink-secondary` + icône 14px | « ORIGINE PROBABLE », « RISQUE ASSOCIÉ », « ACTION RECOMMANDÉE » |
| **Eyebrow de modal** | 10 / 600 / +0.10em / UPPERCASE / `ink-tertiary` | « CONTEXTE », « VOTRE AVIS », « LANGUE », labels jauge |
| **Numérique** | tabular-nums (`"tnum" 1`) | scores, %, compteurs |

Un texte UPPERCASE ≤ 11 px est TOUJOURS un eyebrow (spec ci-dessus) — jamais une variante locale.

---

## 3. ESPACEMENTS — grille 4 px (tolérance 2)

Valeurs autorisées : `2 4 6 8 10 12 14 16 20 24 28 32 40 48…` (pas de 7/9/11/13/15/17 px en padding/margin/gap).
Marge latérale d'écran : **16 px** partout. Gap standard entre cartes : **10–12 px** (une seule valeur par liste).

---

## 4. RAYONS — échelle `{6 · 12 · 16 · 24 · 999}`

| Token | Valeur | Usage |
|---|---|---|
| `--radius-sm` / `--r-sm` | **6** | inputs denses, chips, onglet interne de segmented |
| `--radius-md` / `--r-md` | **12** | boutons, cartes standard, options |
| `--r-lg` | **16** | grandes cartes (home), items de liste |
| `--radius-xl` | **24** | sheets / modaux plein écran |
| `--radius-pill` | 999 | pills, cercles (`50%` pour les ronds) |

**Règle des rayons concentriques : rayon externe = rayon interne + padding**
(ex. segmented : conteneur 8 = onglet 6 + padding 2). C'est la SEULE source de valeurs hors échelle.

---

## 5. OMBRES — 3 niveaux + états, rien d'autre

`--shadow-sm` / `--shadow-md` / `--shadow-lg` (définies par thème). Glows réservés aux états
(risque, focus) via tokens `…-soft/edge`. **Interdit : box-shadow littérale ad hoc, halos décoratifs.**

---

## 6. Z-INDEX — bandes documentées

`1–9` interne composant · `30–59` barres fixes (bottom-bar 55) · `60–99` header/banners ·
`100–299` overlays/popups · `9000+` toasts & système (toast 9990, SW update 9995, codepad 10002).
Pas de nouvelle valeur sans raison écrite en commentaire.

---

## 7. COMPOSANTS — specs au pixel

### Boutons
| Type | Hauteur | Rayon | Texte | Couleurs |
|---|---|---|---|---|
| **Héro** (Importer, ANALYSER) | 52 | 12 | 16 / 700 | fond `accent`, texte `#fff` |
| **Primaire** (Enregistrer, Lancer l'analyse, Envoyer, Générer le rapport) | 46 | 12 | 14 / 600 | fond `accent`, texte `#fff` |
| **Secondaire** (Plus tard, Sans précision, Passer, Nouvelle analyse) | 46 | 12 | 14 / 600 | fond `surface-hi`, bord `border`, texte `ink-secondary` |
| **Fermer (X) / Retour (<)** | 40 × 40 | 50% | icône 20, trait 2.2 | fond `accent`, icône `#fff` — IDENTIQUE partout |
| Cible tactile minimale | 44 px (padding invisible autorisé) | | | |

### Cartes
Fond `surface-hi`, bord 1px `border`, rayon **12**, padding **14–16**.
Grandes cartes home / items liste : rayon **16**. Jamais d'ombre par défaut (ombres = élévation réelle : modaux).

### Modaux / sheets
Rayon **24** (sheet bas : coins hauts seulement), eyebrow + Titre 18/700 + X 40px en haut-droite.
Footer : Secondaire (flex 0) + Primaire (flex 1), gap 10.

### Segmented control (Zones détectées / Image source)
Conteneur : fond `surface-mid`, rayon 8, padding 2. Onglet : rayon 6, 12/600 ;
actif = fond `surface-hi`, texte `ink-primary`, ombre `0 1px 2px rgba(0,0,0,.08)`.

### Jauge de risque
Piste 3 segments (tokens risque), curseur rond blanc bordé `risk-color`.
Labels = Eyebrow de modal ; label actif : couleur `risk-*` + 700.

### États du feedback (pastilles)
Disque 14px : OK=`risk-low` · Moyen/Décalé=`risk-mid` · À revoir/Faux=`risk-hi` —
**les 3 questions utilisent le MÊME mapping** (`false_positives` = rouge). Fonds/cerclages via `…-soft/edge`.

### Icônes
SVG uniquement (stroke 2–2.2, 14/20/24 px). **Emoji interdit comme icône** (drapeaux langue = seule exception héritée).
Une seule croix ✕ et un seul chevron ‹ canoniques (V250) réutilisés partout.

---

## 8. ZONES D'EXCEPTION (intouchables par la normalisation)

1. **PDF jsPDF** (`new jsPDF` ~L18925 & ~L19096) : rendu programmatique, JAMAIS modifié par une passe design écran.
2. **`@media print`** (~L8352) : fallback impression, hors périmètre.
3. **HUD Live View** : palette HUD (§1) — sombre quel que soit le thème.

---

## 9. PROCESSUS (anti-régression)

1. **Un composant = UN bloc de règles.** Interdit d'« empiler » une nouvelle règle `!important`
   en bas de fichier pour corriger la précédente (cause racine du chaos pré-V260 : 12 générations
   de styles pour `.viewer-tab`, 8 pour `.lv-verdict-eyebrow`). On ÉDITE la règle existante.
2. Toute nouvelle valeur passe par un token existant ; sinon on discute le token, pas l'exception.
3. Avant commit UI : `node .claude/tests/audit-design-full.mjs` → vérifier les écrans touchés
   (clair + sombre) + le dump `styles-dump.json` (eyebrows/boutons/rayons conformes).
4. Vérifier `node --check` sur les scripts inline extraits (7 blocs) —
   extraction : `node .claude/tests/check-inline-scripts.mjs`.
5. Les 4 critères (§0) sur chaque texte ajouté.
6. Refactor CSS « zéro diff » (purge, déplacement de règles) : prouver l'identité
   pixel avec `node .claude/tests/audit-viewports.mjs <nom>` (375×568, 375×550
   écran court, 667×375 paysage, 768×1024 sans media ; états risque + toggle) puis
   `node .claude/tests/compare-baseline.mjs <baseline> <run>` (captures
   byte-identiques + styles calculés des éléments visibles identiques).

---

## 10. Dette connue (à purger, sans urgence)

- ~~Générations mortes de règles `!important` dans le bloc `metier-spine-css`~~ —
  **PURGÉ V263→V269** (lots 1-7) : le bloc est passé de ~1600 à ~660 lignes (−58 %),
  une seule génération gagnante par composant (12→1 pour `.viewer-tab`, 8→1 pour
  `.lv-verdict-eyebrow`, etc.), zéro différence de pixel prouvée à chaque lot
  (captures byte-identiques clair+sombre sur 5 viewports + dumps de styles calculés,
  états risque high/mid/low et toggle inclus). Strates restantes, toutes VIVANTES :
  base metier (hides) · V195 (5 blocs) · V188.8 (layout rapport) · V190 résiduel
  (::after tab + [hidden] risque) · V192 (3 cartes analyse + marqueur jauge) ·
  V188-accueil (libellés/accordéons) · V217/V225/V236b (paysage) · V188.2 (≤500) ·
  V196 (AUTORITÉ typo/couleurs/toggle) · V205 résiduel · V231-236 (accueil final).
- Drapeaux emoji du sélecteur de langue → SVG.
- `--t-display/headline/title-*` (48/28/20) : tokens théoriques non utilisés par l'app réelle —
  l'échelle réelle est §2 ; rapprocher les tokens un jour.

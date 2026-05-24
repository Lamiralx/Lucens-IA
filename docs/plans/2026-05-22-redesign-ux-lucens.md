# Redesign UX Lucens IA — Plan d'implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter un thème clair médical + un toggle dark/light à Lucens IA, et polir les composants clés pour une UX épurée, no-scroll et user-friendly.

**Architecture:** L'app utilise déjà des variables CSS dans `:root`. On restructure ces tokens en deux jeux (`[data-theme="light"]` / `[data-theme="dark"]`), on ajoute un switch persistant (localStorage), puis on polit les composants un par un. Le Live View garde ses styles `.lv-*` sombres et reste sombre.

**Tech Stack:** HTML/CSS/JS single-file (`index.html`), déploiement Vercel CLI. Pas de framework de test, pas de git → vérification = contrôle syntaxe JS + `vercel --prod` + contrôle visuel.

**Référence design:** `docs/plans/2026-05-22-redesign-ux-lucens-design.md`

---

## Conventions de vérification (projet sans tests/git)

- **Vérif syntaxe JS** : extraire les blocs `<script>` de `index.html` vers un fichier temporaire `.js` et lancer `node --check` dessus. Si la syntaxe est invalide, corriger avant de continuer.
- **Déploiement** : `vercel --prod --yes`.
- **Checkpoint** = déploiement réussi + validation visuelle utilisateur (remplace le commit git, le projet n'étant pas sous git).

---

## Task 1 : Architecture des tokens de thème (dark + light)

**Files:**
- Modify: `index.html` — bloc `:root` (≈ lignes 40-175) et balise `<html>`

**Step 1 — Séparer les tokens invariants des tokens de thème**

Garder dans `:root` (ne changent pas par thème) : `--font-*`, `--t-*` (typo), `--space-*`, `--radius-*`, `--risk-*`, `--lucens-signature*`, `--fam-*`, `--c-*` (catégories).

**Step 2 — Créer le bloc `[data-theme="dark"]`**

Y déplacer les valeurs sombres ACTUELLES : `--surface-*`, `--border*`, `--hairline*`, `--ink-*`, `--accent*`, `--shadow-*`.

**Step 3 — Créer le bloc `[data-theme="light"]`**

```css
:root[data-theme="light"] {
  --surface-page:    #F4F6F8;
  --surface-low:     #FFFFFF;
  --surface-mid:     #FBFCFD;
  --surface-hi:      #FFFFFF;
  --surface-overlay: #FFFFFF;
  --border:          #E2E5EA;
  --border-hi:       #CBD0DA;
  --hairline:        rgba(12,14,19,0.07);
  --hairline-hi:     rgba(12,14,19,0.14);
  --ink-primary:     #0C0E13;
  --ink-secondary:   #3A4150;
  --ink-tertiary:    #6B7280;
  --ink-dim:         #969CAB;
  --accent:          #0E8C84;
  --accent-hi:       #0B6F69;
  --accent-soft:     rgba(14,140,132,0.10);
  --shadow-sm: 0 1px 2px rgba(12,14,19,0.06);
  --shadow-md: 0 4px 12px rgba(12,14,19,0.08);
  --shadow-lg: 0 12px 32px rgba(12,14,19,0.12);
}
```

**Step 4 — Mettre `<html data-theme="light">`** (clair par défaut au 1er lancement).

**Step 5 — Vérifier**
- Contrôle syntaxe JS, puis `vercel --prod --yes`.
- Visuel : l'app s'affiche en clair, lisible. Le Live View reste sombre.

---

## Task 2 : Switch dark/light + persistance

**Files:**
- Modify: `index.html` — ajouter le bouton switch dans l'en-tête + un `<script>` toggle

**Step 1 — Ajouter le bouton switch**

Un bouton icône soleil/lune, discret, en haut de l'app (près du sélecteur de langue `langSwitch`). Classe `theme-toggle`, `id="themeToggle"`, `aria-label="Changer de thème"`.

**Step 2 — CSS du switch** (sobre, ~36px, utilise les tokens).

**Step 3 — JS toggle** : un `<script>` qui, au chargement, lit `localStorage` clé `lucens_theme` et applique `data-theme` si une valeur valide existe ; au clic sur `#themeToggle`, bascule `data-theme` entre `light` et `dark` et sauvegarde dans `localStorage` (entouré d'un try/catch pour le mode privé).

**Step 4 — Vérifier** : contrôle syntaxe JS, deploy. Visuel : le switch bascule clair↔sombre, le choix persiste après rechargement.

---

## Task 3 : Accent teal appliqué partout

**Files:**
- Modify: `index.html` — `[data-theme="dark"]` accent + audit des usages de `--accent`

**Step 1** — Dans `[data-theme="dark"]` : `--accent: #2DD4BF; --accent-hi: #5EE6D5; --accent-soft: rgba(45,212,191,0.12);`

**Step 2** — Auditer les endroits qui codent le blanc en dur pour des actions (`#FFFFFF` sur boutons primaires) → remplacer par `var(--accent)`.

**Step 3 — Vérifier** : deploy, visuel — boutons primaires teal dans les 2 modes, signature `#D84315` intacte.

---

## Task 4 : Boutons — hiérarchie, cibles, feedback de pression

**Files:**
- Modify: `index.html` — styles boutons (`.inst-cta`, `.inst-alt`, boutons résultats/feedback)

**Step 1** — Primaire = teal plein ; secondaire = contour. Cibles tactiles `min-height: 44px`.

**Step 2 — Feedback de pression** : ajouter à tous les boutons une transition `transform 0.12s ease` et un état `:active { transform: scale(0.97); }`.

**Step 3 — Vérifier** : deploy, visuel — boutons réactifs au touch, hiérarchie claire.

---

## Task 5 : Page Capture — no-scroll

**Files:**
- Modify: `index.html` — section `dropzone` / `inst-*` (≈ lignes 5460-5490)

**Step 1** — Layout en `height: 100dvh`, viseur centré, bouton + stats dans le viewport, aucun scroll.

**Step 2 — Vérifier** : deploy, visuel mobile + desktop — la page capture tient sans scroll.

---

## Task 6 : Page Résultats — restructuration en onglets

**Files:**
- Modify: `index.html` — section résultats (`#results`, `viewerStage`, observations, decision, legend)

**Step 1** — Image annotée fixe en haut. Sous elle, 3 onglets : **Zones** / **Observations** / **Décision**.

**Step 2** — Un seul panneau d'onglet visible à la fois, chacun dimensionné pour tenir sans scroll (ou très peu).

**Step 3** — JS : gestion du changement d'onglet (réutiliser le pattern `.viewer-tab` existant).

**Step 4 — Vérifier** : deploy, visuel — l'analyse complète se consulte par onglets, scroll minimal.

⚠️ Tâche la plus structurante — la traiter isolément, tester en priorité.

---

## Task 7 : Motion — transitions de navigation

**Files:**
- Modify: `index.html` — transitions entre états (intake → loader → results)

**Step 1** — Transitions fondu + léger glissement, ~220ms ease-out, sur les changements d'écran.

**Step 2 — Vérifier** : deploy, visuel — navigation fluide, pas de saut brusque.

---

## Task 8 : Bouton ANALYSER — animation premium

**Files:**
- Modify: `index.html` — bouton d'analyse + son CSS + le hook de lancement d'analyse

**Step 1** — État de chargement : au déclenchement, le label se fond ; un fin arc teal balaie le contour du bouton (CSS `conic-gradient` animé ou SVG `stroke-dashoffset`). Pas de spinner.

**Step 2** — À la fin de l'analyse → transition fluide vers les résultats.

**Step 3 — Vérifier** : contrôle syntaxe JS, deploy, visuel — l'animation est discrète, raffinée, le bouton EST le loader.

---

## Task 9 : QA finale

**Step 1** — Vérifier les 2 modes sur mobile + desktop.
**Step 2** — Vérifier que le Live View reste sombre dans les 2 modes.
**Step 3** — Vérifier no-scroll sur capture, loader, résultats.
**Step 4** — Vérifier persistance du thème après rechargement.
**Step 5** — Vérifier contrastes (textes secondaires lisibles en clair).
**Step 6** — Déploiement final.

---

## Ordre & dépendances

Task 1 → 2 → 3 doivent se suivre (fondations thème).
Tasks 4-8 indépendantes entre elles (composants), faisables dans n'importe quel ordre après Task 3.
Task 9 en dernier.

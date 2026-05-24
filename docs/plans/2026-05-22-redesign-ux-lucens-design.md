# Redesign UX Lucens IA — Document de design

Date : 2026-05-22
Statut : validé

## Contexte

Lucens IA — analyseur de fluorescence UV pour inspection HACCP / hygiène.
Application single-file (`index.html`, ~14 600 lignes), déployée sur Vercel
(`analyse-uv.vercel.app`).

Le design actuel est en **thème sombre uniquement** (surfaces quasi-noires
`#06070A`, encre blanche, esthétique « instrument de labo »). Les utilisateurs
le perçoivent comme **trop futuriste et pas accueillant**.

Utilisateurs cibles (tous peu ou pas technophiles) :
- Inspecteurs hygiène / qualité
- Responsables qualité
- Artisans / petits exploitants
- Prospects découvrant l'outil

## Objectifs

1. **Deux thèmes** : clair (médical) + sombre, avec switch utilisateur.
2. **User-friendly** : accessible au public le moins technique.
3. **Précision + crédibilité** : l'app doit inspirer confiance (outil HACCP sérieux).
4. **No-scroll ou très peu** : chaque écran tient dans un viewport.
5. **Épuré best-in-class** : référence Linear / Things / Stripe.
6. **Navigation fluide** + **micro-interactions premium discrètes**.

## Hors scope (YAGNI)

- Pas de refonte du parcours / de la navigation globale.
- Pas de nouveaux écrans ni de nouvelles fonctionnalités.
- Le moteur d'analyse, le Live View fonctionnel, l'API ne changent pas.

## Architecture du thème

L'app utilise déjà des variables CSS (`--surface-*`, `--ink-*`, etc.).

- Attribut `data-theme="light|dark"` sur `<html>`.
- Deux jeux de valeurs : `:root[data-theme="light"]` et `[data-theme="dark"]`.
- Switch (soleil/lune) qui bascule l'attribut + sauvegarde `localStorage`.
- 1er lancement : **clair par défaut**.
- Le modal Live View (`.lv-*`) a des styles propres codés en dur sombre :
  il **reste sombre automatiquement**, dans les deux modes.

### Tokens qui basculent
Surfaces, encre, bordures, hairlines, ombres.

### Tokens qui ne basculent pas
- Statuts : `--risk-low #6FCF8E`, `--risk-mid #E8C16A`, `--risk-hi #E85A4A`
- Signature de marque : `#D84315`
- Couleurs de catégories de contaminants
- Accent teal (même teinte, luminosité ajustée par mode)

## Palette

### Mode clair (médical)
```
--surface-page    #F4F6F8   fond, gris très clair froid
--surface-low/hi  #FFFFFF   cartes / panneaux, blanc pur + ombre douce
--ink-primary     #0C0E13   titres
--ink-secondary   #3A4150   corps
--ink-tertiary    #6B7280   labels
--ink-dim         #969CAB   fine print
--border          #E2E5EA
--hairline        rgba(12,14,19,0.07)
```

### Mode sombre
Valeurs actuelles conservées (`--surface-page #06070A`, etc.).

### Accent (les deux modes)
```
Accent clair      #0E8C84   teal profond (contraste sur blanc)
Accent sombre     #2DD4BF   teal vif (contraste sur noir)
Signature         #D84315   inchangé
```

## Composants

| Écran | Refonte |
|-------|---------|
| Capture / accueil | Viseur centré, gros bouton, tient dans 1 viewport, guidage clair |
| Loader | Plein viewport, animation discrète |
| Résultats | **Onglets** Zones / Observations / Décision — image annotée fixe en haut, chaque onglet sans scroll |
| Live View | Inchangé, reste sombre |
| Boutons | Hiérarchie nette : primaire (teal plein) / secondaire (contour). Cibles ≥ 44 px |
| Cartes | Blanc + ombre douce + coins arrondis, espace généreux |

## Motion & micro-interactions

- **Feedback de pression** : chaque bouton `scale(0.97)` au `:active`, 120 ms.
- **Navigation** : transitions inter-écrans en fondu + léger glissement, ~220 ms
  ease-out. Pas de saut brusque.
- **Bouton ANALYSER — animation premium discrète** :
  1. Touch → `scale(0.98)`
  2. Déclenchement → le label se fond en douceur
  3. Chargement → un fin arc teal balaie le contour du bouton
     (le bouton est lui-même le loader — pas de spinner, pas de flash)
  4. Terminé → transition fluide vers les résultats
- Règle : aucune animation gratuite. Durées 120-250 ms, easing ease-out.

## Risques & mitigation

- App de 14 600 lignes en production : on touche les composants un par un,
  jamais le flow. Validation visuelle après chaque lot.
- Le passage en clair peut révéler des contrastes insuffisants : vérifier
  l'accessibilité (ratio de contraste) sur les textes secondaires.
- La restructuration des résultats en onglets est le changement le plus
  structurant : la traiter isolément et la tester en priorité.

## Test / validation

- Vérifier le rendu des deux modes sur mobile et desktop.
- Vérifier que le Live View reste sombre dans les deux modes.
- Vérifier le no-scroll sur chaque écran (capture, loader, résultats/onglets).
- Vérifier la persistance du thème (localStorage) après rechargement.

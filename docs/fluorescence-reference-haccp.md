# Référence Lucens IA — Signatures fluorescentes HACCP sous UV-A 365 nm

> **Bible scientifique du système Lucens IA.** Liste exhaustive de ce que l'app DOIT savoir identifier, avec signatures précises et sources.

Date : 2026-05-24
Sources : Stark-Einstein 1925 · FDA Bad Bug Book · Codex Alimentarius · EFSA Scientific Opinions · ISO 22000

## Principe physique

Sous excitation **UV-A 365 nm**, les molécules fluorescentes absorbent un photon UV puis ré-émettent un photon de longueur d'onde supérieure (visible 400-700 nm). La couleur visible perçue dépend du **pic d'émission** caractéristique de chaque fluorophore.

L'identification probabiliste se base sur :
1. **Longueur d'onde du pic** (déterminée par la chimie de la molécule)
2. **Signature RGB** sur capteur Bayer typique smartphone (après auto-white-balance désactivé)
3. **Contexte spatial** (où la zone se trouve : sol, plan de travail, joint, etc.)
4. **Texture** (lisse vs structurée → discrimine biofilm vs film chimique)

## Bibliothèque de signatures de référence

### A. Fluorophores BIOLOGIQUES (résidus organiques)

| Fluorophore | Pic émission | Couleur visible | RGB référence | Origine biologique | Contexte HACCP |
|---|---|---|---|---|---|
| **NADH / NADPH** | 460 nm | Bleu profond | `(110, 140, 230)` | Coenzymes métaboliques de toute cellule vivante | Résidus protéiques frais (viande, fluides bio, lait frais) |
| **Tryptophane** | 350 nm (UV proche) → halo violet 420 nm | Violet-blanc pâle | `(180, 175, 220)` | Acide aminé aromatique dans toutes protéines | Marqueur protéique général |
| **FAD / Riboflavine** (vitamine B2) | 525 nm | **Jaune-vert vif** | `(200, 215, 90)` | Coenzyme flavinique, vitamine B2 | **Lait, œufs, levure, fromages, certains nettoyants industriels** |
| **Vitamine B6 (pyridoxal)** | 360-420 nm | Bleu pâle | `(170, 190, 230)` | Vitamine présente dans nombreux aliments | Résidus fortifiés (céréales, lait infantile) |
| **Hyaluronate / Mucus** | 470 nm | Bleu-cyan | `(140, 180, 220)` | Sécrétions muqueuses animales/humaines | Indication contamination par fluide corporel |
| **Collagène (UV-aged)** | 405-440 nm | Bleu-violet | `(150, 160, 220)` | Tissu conjonctif viande, peau | Résidu d'os/cartilage en transformation viande |

### B. Fluorophores PIGMENTAIRES (sang, urines, déjections, végétal)

| Fluorophore | Pic émission | Couleur visible | RGB référence | Origine | Contexte HACCP |
|---|---|---|---|---|---|
| **Porphyrines / Hème** | 635 nm | **Rouge vif** | `(220, 60, 70)` | Pigment du sang (hémoglobine), des urines de mammifères | **Sang, urine rongeurs, déjections insectes** |
| **Chlorophylle** (résiduelle) | 685 nm | Rouge profond | `(180, 50, 50)` | Pigment photosynthétique végétal | Résidu fruit/légume, café, thé |
| **Acide urique (urochrome)** | 405-440 nm | Jaune-orange brillant | `(230, 200, 100)` | Urine de mammifères (rongeurs ++) | **Signature directe de nuisible** — action immédiate |
| **Phyllobiline (résidus végétaux)** | 660-700 nm | Rouge sombre | `(170, 60, 60)` | Dégradation chlorophylle | Résidu végétal vieilli |
| **Lycopène** | 590 nm | Orange-rouge | `(220, 130, 80)` | Tomate, pastèque, pamplemousse rose | Résidu transformation fruits rouges |

### C. Fluorophores CHIMIQUES (détergents, lubrifiants, médicaments)

| Fluorophore | Pic émission | Couleur visible | RGB référence | Origine | Contexte HACCP |
|---|---|---|---|---|---|
| **Stilbenes (azurants optiques)** | 430 nm | **Bleu-cyan intense** | `(130, 180, 250)` | Lessives, savons professionnels | **Résidu de détergent** — défaut de rinçage |
| **Huiles minérales / HAP** | 480 nm | Bleu-vert pâle | `(130, 175, 195)` | Hydrocarbures lubrifiants machine | **Critique en agro** — fuite mécanique sur produit |
| **Filtres UV cosmétiques** (avobenzone, octocrylène) | 440 nm | Blanc-bleuté très clair | `(200, 220, 250)` | Crème solaire, dentifrice, crème mains | Traces opérateurs (mains, peau) |
| **Tetracyclines** (antibiotiques) | 450-490 nm | Jaune-vert pâle | `(180, 200, 130)` | Résidu antibiotique vétérinaire | Critique en lait/viande — non-conformité réglementaire |
| **Sulfamides** | 460 nm | Bleu pâle | `(160, 180, 220)` | Antibiotiques médicaments | Idem tetracyclines |
| **Aflatoxines** (mycotoxines) | 425 nm | **Bleu-violet fluo** | `(140, 150, 230)` | Métabolites Aspergillus | **Critique** — toxines cancérigènes sur grains/oléagineux |
| **Ochratoxine A** | 467 nm | Vert-blanc | `(180, 210, 180)` | Mycotoxine fungique | Vins, céréales, café |

### D. Fluorophores MICROBIENS (biofilms, colonisations)

| Fluorophore | Pic émission | Couleur visible | RGB référence | Origine | Contexte HACCP |
|---|---|---|---|---|---|
| **Pyoverdines** (Pseudomonas spp.) | 510-520 nm | Vert-jaune diffus | `(150, 200, 130)` | Sidérophores sécrétés par Pseudomonas aeruginosa, fluorescens | **Biofilm bactérien établi** — très problématique |
| **Pyocyanine** (Pseudomonas) | 690 nm + 460 nm double pic | Bleu-vert ambigu | `(140, 180, 170)` | Toxine bleu-vert Pseudomonas aeruginosa | Idem biofilm avancé |
| **Tryptophane bactérien** | 350 nm + halo | Bleu pâle diffus | `(160, 175, 220)` | Métabolisme bactérien général | Indicateur précoce de croissance |
| **NADH bactérien** | 460 nm | Bleu profond uniforme | `(115, 145, 230)` | Biofilm en croissance active | Croissance microbienne récente |

### E. Fluorophores PARASITAIRES (indicateurs nuisibles)

| Fluorophore | Pic émission | Couleur visible | RGB référence | Origine | Contexte HACCP |
|---|---|---|---|---|---|
| **Urine de rongeur** (mélange acide urique + porphyrines) | 405-635 nm large | **Jaune-orange à rouge brillant** | `(230, 200, 100)` | Souris, rats, blattes | **Signe direct nuisible — action urgente** |
| **Frass d'insectes** (déjections) | 460-500 nm | Bleu-vert ponctuel | `(140, 180, 180)` | Cafards, blattes, scarabées | Infestation insectes |
| **Soie d'araignée** | 410-440 nm | Bleu-violet | `(160, 170, 220)` | Toiles, soies de mues | Présence arachnides |
| **Plumes/poils** (kératine) | 405-450 nm | Bleu pâle | `(180, 190, 215)` | Oiseaux (pigeons), rongeurs | Contamination physique |

## Hiérarchie de risque HACCP

Pour chaque signature détectée, l'app applique un **niveau de risque** :

| Niveau | Code couleur app | Exemples de signatures correspondantes |
|---|---|---|
| **CRITIQUE** (action immédiate) | 🔴 Rouge | Urine rongeur · sang frais · huile minérale sur aliment · aflatoxines |
| **ÉLEVÉ** (re-nettoyage rapide) | 🟠 Orange | Biofilm Pseudomonas · résidu antibiotique · porphyrines |
| **MOYEN** (surveiller) | 🟡 Jaune | Résidu protéique frais · détergent résiduel · cosmétique |
| **FAIBLE** (information) | 🟢 Vert | Chlorophylle résiduelle · vitamine B2 (lait normal) |

## Règles de discrimination importantes

### Reconnaître une LED parasite vs une vraie fluorescence
| Critère | LED parasite | Vraie fluo |
|---|---|---|
| Saturation | Très haute (couleur "pure") | Modérée (avec composante blanche) |
| Localisation | Ponctuelle, isolée | Souvent en patch ou diffuse |
| Spectre | Pic étroit unique | Pic large avec halo |
| Action | **Ignorer** | Analyser |

### Reconnaître un substrat coloré (sol jaune) vs résidu jaune
| Critère | Substrat (sol époxy jaune) | Résidu (urine rongeur) |
|---|---|---|
| Étendue | Très large (> 25% image) | Petite, localisée |
| Uniformité | Couleur stable partout | Variations d'intensité, contours |
| Position | Couvrant le sol | En coin, bordure, recoin |
| Texture | Lisse uniforme | Halo, gradient |

### Discrimination biofilm vs film chimique
| Critère | Biofilm Pseudomonas | Détergent résiduel |
|---|---|---|
| Texture | Diffuse, "vivante", gradient | Lisse, uniforme, mécanique |
| Couleur | Vert-jaune avec halo | Bleu-cyan plus pur |
| Localisation | Joints silicone, recoins humides | Surfaces de nettoyage récent |
| Action | Re-nettoyage + désinfection | Rinçage simple |

## Utilisation par Lucens IA

Cette bibliothèque est **injectée dans le prompt Claude** à chaque analyse (`api/analyze.js`). Le modèle reçoit la table de référence ET la photo, et identifie les zones en se basant sur :
- La couleur perçue dans la photo
- Le matching avec les signatures de référence (table A à E)
- Le contexte sectoriel utilisateur (restauration, agro, pharma, etc.)
- La hiérarchie de risque appliquée

Cela assure que Lucens IA donne des verdicts **déterministes et scientifiquement fondés**, pas des intuitions générales.

## Évolution

Cette bibliothèque est versionnée avec le code. Pour ajouter une nouvelle signature :
1. Ajouter l'entrée dans la table appropriée (A/B/C/D/E)
2. Mettre à jour `api/_lib/spectro.js` avec la signature RGB
3. Mettre à jour le prompt Claude dans `api/analyze.js` pour inclure la nouvelle entrée
4. Tester sur une photo de référence

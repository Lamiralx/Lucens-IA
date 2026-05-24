# Carte de calibration Lucens — modèle 3D

> **Version courante : V3** (carte UNIQUE Lucens, conçue pour calibration métrologique complète)
> V2 conservée comme archive de référence.

## Fichiers livrés

| Fichier | Statut | Usage |
|---|---|---|
| **`carte-lucens-v3.stl`** ⭐ | **Production** | Import direct dans Creality Print, Bambu Studio, PrusaSlicer |
| **`carte-lucens-v3.scad`** | Production | Source OpenSCAD avec paramètres éditables |
| `carte-lucens-v2.stl` | Archive | Version précédente (6 patchs basiques + QR seul) |
| `carte-lucens-v2.scad` | Archive | OpenSCAD V2 |

## Liens de téléchargement direct (Vercel)

- 📥 STL V3 : **https://analyse-uv.vercel.app/carte-lucens-v3.stl**
- 📥 SCAD V3 : **https://analyse-uv.vercel.app/carte-lucens-v3.scad**

## V3 — Conçue spécifiquement pour Lucens IA

Format final : **150 × 100 × 2,5 mm**

Composition (8 zones métrologiques + 4 éléments de signature) :

### Authentification & rectification géométrique
- **QR Lucens central** 20×20 mm contenu `LUCENS:CALIBV3` (lu par jsQR dans l'app, sert aussi de fiducial principal)
- **3 marqueurs fiducials** carrés 6×6 mm aux 3 autres coins (top-right, bottom-left, bottom-right) → rectification de perspective robuste même si la carte est inclinée à 30°

### Calibration colorimétrique
- **4 cuvettes échelle de gris** 18×18 mm en ligne → blanc / gris 25% / gris 50% / noir (à peindre acrylique mat)
  → calibre la **courbe gamma** du capteur (réponse non-linéaire à la lumière)

### Calibration signatures fluo + résolution spatiale
- **4 cuvettes fluo** 24×24 mm avec **textures uniques par patch** (à peindre acrylique UV) :
  - **Patch A** : rainures horizontales 0,4 mm × 0,8 mm de pas
  - **Patch B** : rainures verticales 0,4 mm × 0,8 mm de pas
  - **Patch C** : grille croisée 0,4 × 0,4 mm × 1,2 mm de pas
  - **Patch D** : points en quinconce 0,6 mm × 1,5 mm de pas (signature Lucens unique)
  → calibre les **signatures fluorescentes** + la **discrimination de motifs** (biofilm lisse vs résidu structuré)

### Calibration optique
- **Mire de résolution spatiale** : 3 zones côte-à-côte de lignes parallèles à 0,2 / 0,5 / 1,0 mm
  → mesure la **netteté effective** de la chaîne optique. Lucens IA peut signaler "résolution effective 0,8 mm".
- **Barre d'échelle 10 mm** calibrée avec graduations tous les 2 mm
  → conversion pixels → mm pour mesures réelles ("zone de 35 mm²" au lieu de "1,2% image")

### Identité & traçabilité
- **Logo "L" Lucens** embossé 12×8 mm, hauteur 0,4 mm — signature visuelle de marque
- **Cadre code série** vide 24×6 mm — à graver/peindre individuellement (ex : `LCN-V3-00042`) pour traçabilité métrologique pro

## Stratégie d'impression (Creality K2 + CFS)

| Slot CFS | Filament | Zones imprimées |
|---|---|---|
| 1 | PLA blanc opaque | Base + zones blanches + fond des cuvettes |
| 2 | PLA noir mat | QR (modules noirs) + 3 fiducials + barre d'échelle |

→ **1 seul print** sur K2 avec swap automatique CFS. Pas d'intervention manuelle.

## Paramètres de slicing recommandés

| Paramètre | Valeur |
|---|---|
| Hauteur de couche | 0,16 mm (les textures fluo font 0,20 mm minimum) |
| Infill | 15% |
| Top/bottom layers | 4 |
| Support | Non |
| Adhésion plateau | Brim 5 mm (la carte fine peut warper) |
| Vitesse | Standard |

Temps d'impression estimé : 2-3h selon vitesse.

## Application de la peinture (étape post-print)

### Étape 1 — Échelle de gris (acrylique mat, n'importe quelle marque)
1. **Cuvette 1** : laisser blanc (PLA nu)
2. **Cuvette 2** : peindre gris 25% (mélange blanc + noir 3:1)
3. **Cuvette 3** : peindre gris 50% (mélange blanc + noir 1:1)
4. **Cuvette 4** : peindre noir mat (acrylique noir épais)

### Étape 2 — Patchs fluo (acrylique UV-réactive)
- **1 seule couleur recommandée** sur les 4 cuvettes pour la reproductibilité MAXIMALE entre cartes
- Couleur recommandée : **ROSE fluo** ou **JAUNE fluo** (les plus réactives sous UV-A 365 nm)
- Marques pro : Liquitex Heavy Body Fluorescent, Pébéo Fluo, Schmincke
- Les textures uniques différencient déjà les 4 zones — la couleur n'a pas besoin d'être différente

### Étape 3 — Code série individuel
- Graver `LCN-V3-XXXXX` dans le cadre prévu (laser, dremel, ou feutre permanent)
- Enregistrer chaque numéro dans ton système de traçabilité Lucens

### Étape 4 — Protection
- Vernis acrylique mat transparent sur l'ensemble (optionnel mais recommandé pour usage terrain HACCP)
- Séchage 24 h à plat

## Vérification après impression

1. Ouvrir Live View dans l'app Lucens (analyse-uv.vercel.app) → ⚙ → Carte Lucens
2. Allumer la lampe UV-A 365 nm
3. Présenter la carte à 25 cm, QR vers la caméra
4. L'app détecte automatiquement le QR `LUCENS:CALIBV3` → "Carte Lucens ✓ · maintenez immobile…"
5. Maintenir 1 s → calibration enregistrée avec les nouvelles signatures multi-textures

## Régénérer la carte

Si tu modifies des paramètres (taille de cuvettes, profondeur, textures) :

```bash
python scripts/generate_carte_lucens_3d.py
```

Les fichiers `.scad` et `.stl` sont régénérés automatiquement dans ce dossier ET copiés à la racine du projet pour déploiement Vercel.

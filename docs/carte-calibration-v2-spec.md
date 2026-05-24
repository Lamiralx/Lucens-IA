# Carte de calibration Lucens — Spec V2 (3D printée)

Date : 2026-05-23
Statut : spec de référence pour impression 3D
Remplace : `carte-calibration.html` (V1 DIY surligneurs)

---

## Objectifs

1. **Authentification absolue** par QR intégré (zéro faux positif lors de la calibration).
2. **Précision de lecture des patchs** indépendante de l'angle/inclinaison de la carte (le QR sert de marqueur géométrique de référence, façon ArUco).
3. **Calibration colorimétrique + signatures fluorophores** dans un seul scan.
4. **Reproductibilité** : carte 3D imprimée → texture et géométrie identiques entre toutes les unités.
5. **Référence d'échelle** intégrée pour mesures en mm² dans Live View.

---

## Dimensions globales

- **Format carte :** 150 × 100 mm (compatible main, format ISO standard légèrement réduit)
- **Épaisseur :** 2,5 mm (3D print PLA ou PETG, suffisant pour rigidité)
- **Marges :** 5 mm tout autour
- **Orientation de référence :** QR en haut-gauche (l'app gère l'orientation via la position du QR)

---

## QR code — élément central

| Propriété | Valeur |
|---|---|
| **Contenu** | `LUCENS:CALIBV2` (exact, sensible à la casse) |
| **Format** | QR Code version 2 minimum (25×25 modules), correction d'erreur niveau H (30%) |
| **Taille imprimée** | 22 × 22 mm |
| **Position centre** | (16, 16) mm depuis coin haut-gauche de la carte |
| **Rendu 3D** | Modules NOIRS en relief de 0,4 mm (saillie) sur fond BLANC plat. Contraste mécanique suffisant pour lecture même sous UV |
| **Quiet zone** | 4 modules de marge claire autour (~3,5 mm) |

**Pourquoi `LUCENS:CALIBV2` :** le prefix `LUCENS:` permet à l'app de reconnaître toute carte Lucens future ; le suffixe `CALIBV2` indique la version du layout (le code applique le bon plan de patchs).

**Important :** le code détecte aussi la **position des 4 coins du QR** dans l'image (via jsQR). Cette information sert à calculer où sont les patchs de calibration, peu importe l'angle de la carte. C'est le rôle de **marqueur de référence** (fiducial marker).

---

## Matériau choisi : **3D print PLA + peinture acrylique UV** (workflow utilisateur)

Pas de filament fluo dispo → on imprime la base 3D en PLA standard et on applique de la **peinture acrylique UV-réactive** sur les zones fluo.

### Stratégie d'impression 3D (Creality K2 + CFS)

| Élément | Matériau | Slot CFS |
|---|---|---|
| Base de la carte | PLA blanc opaque | 1 |
| Patch BLANC | PLA blanc (même bobine que base, pas peint) | 1 |
| Patch NOIR | PLA noir mat | 2 |
| QR (modules noirs) | PLA noir mat | 2 |
| Cuvettes pour patchs fluo | PLA blanc, creusées de 0,5 mm | 1 |

→ **Avantage du multi-bobines K2** : le noir et le blanc impriment ensemble en 1 print, sans swap manuel.

### Patchs fluo : peinture acrylique UV

**Conseil critique pour la reproductibilité :**

- **Une SEULE couleur de peinture acrylique UV** appliquée sur les 4 zones fluo (max recommandé : 2 couleurs)
- Pourquoi : la variabilité entre marques d'acrylique UV est énorme. Si tu mets 4 couleurs différentes, chaque carte que tu refais aura des signatures différentes selon les pots utilisés. Avec 1 seule couleur, c'est reproductible si tu utilises toujours le même pot/la même référence.
- **Couleur recommandée : ROSE fluo ou JAUNE fluo** (plus réactives sous UV-A 365 nm que cyan/vert peinture)
- Marque suggérée : Acrylique UV de marque artiste (Liquitex Heavy Body Fluorescent, Pébéo Fluo, Schmincke Fluo) — ces marques ont des pigments fluorescents standardisés
- À éviter : peinture "fluo" bas de gamme (papeterie/loisirs créatifs) — pigments très variables

### Application de la peinture (technique)

1. **Imprimer la carte avec des cuvettes** de 0,5 mm de profondeur pour les 4 patchs fluo (au lieu de patchs plats)
   - Pourquoi : la cuvette retient la peinture sans débordement → couche uniforme reproductible
2. **Préparer la peinture** : bien mélanger le pot avant chaque utilisation (les pigments fluo sédimentent)
3. **Remplir chaque cuvette à ras** avec un pinceau plat ou une spatule fine
4. **Lisser** avec une carte rigide passée d'un trait sur la surface → couche d'épaisseur uniforme
5. **Sécher à plat 24 h** minimum (la peinture acrylique épaisse craque si manipulée trop tôt)
6. **Optionnel : vernis acrylique mat transparent** sur les patchs fluo pour protéger des rayures

→ Avec cette méthode, tu obtiens une carte avec des signatures fluo répétables entre 2 cartes que tu fabriques (à condition d'utiliser le même pot de peinture).

## Layout des patchs (V2.0 — 6 patchs, compatible code actuel)

Grille 3 colonnes × 2 lignes, à droite du QR.

| # | Rôle (code) | Label | Position centre (mm depuis coin haut-gauche carte) | Taille | Matériau (workflow acrylique) |
|---|---|---|---|---|---|
| 1 | `white` | Blanc | (57,5 ; 30) | 30 × 30 mm | PLA blanc nu (plat) |
| 2 | `fluo` | Fluo A | (92,5 ; 30) | 30 × 30 mm | **Cuvette 0,5 mm** remplie d'**acrylique UV rose** |
| 3 | `fluo` | Fluo A | (127,5 ; 30) | 30 × 30 mm | Idem (même couleur — reproductibilité max) |
| 4 | `fluo` | Fluo A | (57,5 ; 70) | 30 × 30 mm | Idem |
| 5 | `fluo` | Fluo A | (92,5 ; 70) | 30 × 30 mm | Idem |
| 6 | `black` | Noir | (127,5 ; 70) | 30 × 30 mm | PLA noir mat nu (plat) |

**Variante 2 couleurs** (si tu veux un peu de classification supplémentaire) :
- Patchs 2-3 en **rose fluo**, patchs 4-5 en **jaune fluo** (ou vert) → 2 signatures fluo distinctes
- Toujours plus reproductible que 4 couleurs différentes

**Note importante :** le code Lucens IA accepte indifféremment 1, 2 ou 4 couleurs fluo distinctes. Plus tu en mets, plus l'IA pourra classer finement les contaminants en Live View. Mais 1 seule couleur suffit pour calibrer le système de base (balance des blancs + signature fluo de référence + plancher de bruit).

### Quel intérêt à plusieurs couleurs fluo (si tu peux investir plusieurs pots d'acrylique) ?

Chaque couleur sert de **référence chromatique** pour une famille de contaminants :

| Couleur fluo carte | Contaminant correspondant en pratique |
|---|---|
| Jaune fluo | Résidus organiques (protéines, sucres, fluides bio) |
| Vert fluo | Signature large, biofilm jeune |
| Cyan / bleu fluo | Détergents, azurants optiques |
| Rose / magenta fluo | Porphyrines, sang, déjections de nuisibles |

→ Plus tu en mets, plus la **classification automatique** des zones contaminées par l'IA en Live View est précise. Mais **1 couleur suffit** pour que le système fonctionne.

**Espacement entre cellules :** 5 mm (lisible visuellement + tolérance d'impression).

**Position du QR relative aux patchs (utilisée par le code) :**
```js
// Offsets en mm depuis le centre du QR (16, 16)
PATCH_OFFSETS_MM = [
  { role: 'white',  label: 'Blanc',  dx:  41.5, dy:  14 },
  { role: 'fluo',   label: 'Jaune',  dx:  76.5, dy:  14 },
  { role: 'fluo',   label: 'Vert',   dx: 111.5, dy:  14 },
  { role: 'fluo',   label: 'Cyan',   dx:  41.5, dy:  54 },
  { role: 'fluo',   label: 'Rose',   dx:  76.5, dy:  54 },
  { role: 'black',  label: 'Noir',   dx: 111.5, dy:  54 },
];
// Rayon d'échantillonnage : 12 mm autour du centre de chaque patch
PATCH_SAMPLE_RADIUS_MM = 12;
```

---

## Améliorations physiques (3D printables)

### A — Repère d'échelle (bonus précision Live View)
- Barre graduée **10 mm** imprimée/embossée en bas de la carte (y=92,5 mm).
- Permet à l'app de calculer pixels/mm → mesures de zones contaminées en **mm²** au lieu de pourcentages.
- Implémentation : 5 graduations de 2 mm, hauteur 1 mm, largeur de barre 10 mm centrée (x=75 ; y=92,5).

### B — Texture lisse vs rugueuse (gain catégorisation)
- Deux petites zones texturées (15 × 8 mm) en bas-gauche, à côté du QR.
- Zone 1 (LISSE) : surface miroir 3D, simule une surface alimentaire/inox.
- Zone 2 (RUGUEUSE) : pattern grille croisée 0,3 mm de profondeur, simule joint silicone/biofilm structuré.
- Calibrent la distinction "résidu lisse vs structuré" dans la catégorisation IA (biofilm vs film chimique).

### C — Logo Lucens embossé (authentification secondaire + premium)
- Logo "L" Lucens centré en bas-droite, 15 × 15 mm, gravé 0,2 mm.
- Pas utilisé par le code (le QR suffit) mais ajoute une couche d'authentification visuelle pour l'utilisateur.

---

## Codage de la carte côté logiciel

L'app fait :

1. **Détection QR** via `jsQR` à chaque tick (250 ms en mode calibration carte).
2. Si QR.data commence par `LUCENS:CALIBV2` → version V2 confirmée.
3. Récupère les 4 coins du QR dans l'image : `code.location.topLeftCorner`, etc.
4. **Calcule** depuis ces 4 coins :
   - Centre du QR en pixels (moyenne des 4 coins)
   - Échelle pixels/mm = `distance(topLeft, topRight) / 22` (QR fait 22 mm)
   - Angle de rotation = `atan2(topRight.y - topLeft.y, topRight.x - topLeft.x)`
5. **Pour chaque patch**, calcule sa position image via rotation + translation :
   ```
   patchX = qrCenterX + (offset.dx * cos(angle) - offset.dy * sin(angle)) * pxPerMm
   patchY = qrCenterY + (offset.dx * sin(angle) + offset.dy * cos(angle)) * pxPerMm
   ```
6. **Échantillonne** chaque patch dans un disque de rayon `12 mm × pxPerMm`.
7. Passe les samples au moteur de calibration existant (inchangé).

→ **La carte peut être inclinée/tournée, la lecture des patchs reste précise.**

---

## Fichiers concernés côté code

- `index.html` :
  - `EXPECTED_QR_PREFIX = 'LUCENS:'` (générique pour future compat) 
  - `EXPECTED_QR_FULL = 'LUCENS:CALIBV2'` (validation stricte du layout)
  - Constante `PATCH_OFFSETS_MM` selon le tableau ci-dessus
  - `captureCalibration()` : lit les positions depuis QR au lieu du cadre-guide quand QR détecté
  - Cadre-guide visuel : reste affiché mais purement indicatif (l'utilisateur sait où viser)

---

## Migration depuis V1

- Cartes V1 DIY (surligneurs) : ne fonctionnent plus avec le nouveau code (pas de QR).
- Période transitoire : le code peut accepter un fallback "pas de QR" pour V1 si demandé.
- Recommandé : abandonner V1 dès que les cartes V2 3D sont en service.

---

## Validation / tests à faire après impression

1. Imprimer 1 carte test → vérifier que jsQR lit `LUCENS:CALIBV2` à 20 cm sous lumière ambiante (lampe UV éteinte).
2. Allumer UV-A 365 nm → vérifier que jsQR lit toujours (le noir 3D doit rester contrasté).
3. Test de tilt : carte à 20°, 30°, 45° → calibration doit déclencher et patches lus correctement.
4. Test à différentes distances : 15 cm, 25 cm, 35 cm → l'échelle px/mm calculée doit varier proportionnellement.
5. Vérifier qu'un QR aléatoire (boîte de céréales, ticket) ne déclenche RIEN.

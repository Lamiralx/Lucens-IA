# Lucens Inspector V1 — Spec produit complète

Date : 2026-05-23
Statut : MVP industrialisation, sourcing en cours
Cible commerciale : pros HACCP (auditeurs certifiés, responsables QHSE chaînes alimentaires, vétérinaires inspection, pharmacies, EHPAD, hôpitaux)

## Positionnement marché

| Acteur | Prix | Position vs Lucens |
|---|---|---|
| Bactiscan FAS 365 | 3 500 - 5 000€ | Concurrent direct premium |
| **Lucens Inspector** | **2 850€** | 20-40% moins cher, intelligence IA supérieure |
| Lampes UV-A génériques + smartphone | 30-100€ | Outil amateur, sans aide à la décision |

→ Trou de marché clair entre amateur (< 100€) et premium (3500€+). Lucens Inspector vise le mid-pro à 2 850€.

## Architecture

Format **moniteur-caméra** type HIKMICRO Pocket2 / InfiRay Tube. Pas un assemblage tablette + accessoires. Un vrai instrument intégré.

```
┌─────────────────────────────────────┐
│                                       │
│   ┌──────────────────┐              │
│   │  Écran tactile 7" │              │
│   │  (cradle intégré) │              │
│   └──────────────────┘              │
│             ┃                         │
│   ┌─────────┸──────────┐            │
│   │  Module optique :   │            │
│   │   • Caméra UVC 4K   │            │
│   │   • Lampe UV-A 365  │            │
│   │   • Filtres optiques│            │
│   └─────────┬──────────┘            │
│             ┃                         │
│   ┌─────────┸──────────┐            │
│   │  Poignée pistolet  │            │
│   │  + trigger physique │            │
│   │  + batterie 18650  │            │
│   └────────────────────┘            │
│                                       │
└─────────────────────────────────────┘
```

## Spec technique détaillée

### Module optique (cœur)

| Paramètre | Valeur | Justification |
|---|---|---|
| Capteur caméra | Sony IMX678 STARVIS 2 (recommandé) ou IMX415 (économique) | Capteur 1/1.8" idéal pour fluorescence faible UV-A |
| Résolution capture | 3840 × 2160 @ 30 fps (4K UHD) | Détails fins de cartographie HACCP |
| Interface caméra | USB UVC standard | Compatibilité PWA Chrome / WebRTC standard |
| Mode exposure / WB | Manuel obligatoire | Auto-WB déforme couleur fluorescence UV |
| Ouverture optique | f/1.6 à f/2.0 | Maximise captation lumière fluo |
| Focale | Fixe pour distance 10-30 cm | Distance d'inspection typique HACCP |
| Filtre côté caméra | Long-pass 400 nm | Bloque la lumière UV directe |
| Source d'éclairage | Nichia NCSU033D (800 mW @ 365 nm) ou NVSU233B (1450 mW) | LED UV-A de référence industrielle |
| Filtre côté lampe | Passe-bande 365 nm ±10 nm | Élimine la lumière visible parasite émise par la LED |
| Driver lampe | Courant constant 350 mA - 500 mA (NCSU033D) | Stabilité fluorescence reproductible |

### Écran / contrôleur

| Paramètre | Valeur |
|---|---|
| Taille | 7" tactile (max) |
| Résolution | 1024 × 600 minimum, 1280 × 720 recommandé |
| OS | Android 13 ou plus récent |
| RAM | 3 Go minimum (4 Go recommandé) |
| Stockage | 32 Go minimum |
| Connectivité | WiFi 6 dual band, Bluetooth 5.0 |
| USB | USB-C OTG (pour caméra UVC) + USB-C charge |
| Pré-installé | App Lucens IA Pro en mode kiosque, désactivation lancement autres apps |

### Châssis / boîtier

| Paramètre | Valeur |
|---|---|
| Format | Pistolet ergonomique, poignée droite |
| Matériau | TPU rigide + insert alu pour module optique (dissipation thermique LED) |
| Indice protection | IP54 minimum (IP65 idéal pour usage chambre froide / lavage haute pression) |
| Trigger physique | Bouton 2-positions : touche légère = focus / pression complète = analyse |
| Boutons latéraux | +/− pour sensibilité, bouton retour |
| Couleur | Noir mat avec sérigraphie Lucens orange signature |

### Batterie

| Paramètre | Valeur |
|---|---|
| Type | Li-ion 18650 amovible (standard, facile remplacement) |
| Capacité | 3 400 mAh minimum |
| Autonomie utilisation continue | 4-6 h |
| Charge | USB-C PD, ~2 h pour charge complète |
| Indicateur niveau | Affiché en permanence dans l'app + LED physique sur boîtier |

## BOM cible (production série 100+ unités)

| Composant | Référence indicative | Coût unitaire |
|---|---|---|
| Coque pistolet custom + écran 7" intégré | OEM Hangzhou Micron / Shenzhen NNPO | 80€ |
| Caméra USB UVC 4K | Sinoseen IMX415 OEM ou équivalent IMX678 | 90€ |
| Lampe Nichia NCSU033D + driver | Lumistrips ou Ledrise | 50€ |
| Filtre 365 nm passe-bande | Edmund Optics ou Aliexpress | 15€ |
| Filtre 400 nm passe-long | idem | 15€ |
| Optique caméra M12 f/1.8 fixe | Aliexpress | 10€ |
| Batterie 18650 + holder + circuit charge | Aliexpress | 12€ |
| Câbles internes + PCB connectique | Assemblage local | 15€ |
| Carte calibration 3D-printée + peinte | Production locale | 5€ |
| Packaging premium + manuel + carte rapide | Imprimerie locale | 25€ |
| **TOTAL BOM** | | **~317€** |

→ Sur budget cible 400€ : **marge BOM de 83€** pour aléas, contrôle qualité, frais sourcing.

## Marge commerciale

| Poste | Montant |
|---|---|
| Prix vente HT | 2 850€ |
| Coût de revient (BOM + assemblage + contrôle) | 400€ |
| **Marge brute** | **2 450€ (86%)** |
| Provisions hors-BOM (SAV, certification, formation, support, marketing, distribution) | ~700-800€ |
| **Marge nette estimée** | **~1 650€ / unité (58%)** |

## Software inclus (Lucens IA Pro)

Inclus 12 mois avec le hardware. Renouvellement abonnement annuel 199€/an ou 19€/mois.

Fonctionnalités Pro :
- Analyse IA Claude haute précision (vs version Free limitée)
- Multi-utilisateurs (équipe)
- Export PDF brandé client (white-label rapport)
- Sync historique cloud multi-device
- API d'export vers logiciels QHSE
- Support prioritaire (email + chat 5j/7)
- Mises à jour modèle IA prioritaires
- Carte de calibration garantie reproductible

## Certifications cibles

| Certification | Statut | Coût indicatif | Délai |
|---|---|---|---|
| CE marking (directive basse tension + EMC) | Obligatoire UE | ~3 000-5 000€ (essais labo) | 2-3 mois |
| ISO 9001 (process production) | Recommandé | ~3 000-8 000€/an | 6 mois |
| Photobiologic safety (IEC 62471 — lampe UV) | Obligatoire UV | ~2 000€ | 1 mois |
| RoHS (substances dangereuses) | Obligatoire UE | inclus dans CE | — |
| FCC (si export USA plus tard) | Optionnel | ~2 500€ | 2 mois |

## Roadmap industrialisation

| Phase | Durée | Livrables |
|---|---|---|
| **1 — Sourcing & RFQ** | 4 semaines | Devis Hangzhou Micron + Shenzhen NNPO, comparaison, sélection partenaire |
| **2 — Proto pré-série** | 6 semaines | 5 unités tournables pour tests internes + adaptation PWA |
| **3 — Essais labo + certif** | 8 semaines | CE marking, photobio safety |
| **4 — Production pilote** | 4 semaines | 50 unités, contrôle qualité, validation |
| **5 — Production série** | continu | 100+ unités / mois |
| **TOTAL avant 1re vente** | **~22 semaines** | ~5-6 mois depuis RFQ envoyé |

## Sourcing fournisseurs validés

| Composant | Fournisseur 1 | Fournisseur 2 |
|---|---|---|
| Coque pistolet OEM | [Hangzhou Micron Control Technology](https://thermalcamera.en.alibaba.com/) | [Shenzhen NNPO Technology](https://nnpo.en.alibaba.com/) |
| Caméra USB UVC 4K | [Sinoseen OEM IMX415](https://www.sinoseen.com/usb-camera-module-oem-8mp-imx415-for-high-resolution-industrial-imaging) | [Arducam IMX678 USB 3.0](https://www.arducam.com/arducam-8-3mp-imx678-manual-focus-usb-3-0-camera-module.html) |
| Lampe UV-A LED Nichia | [Lumistrips NCSU033D](https://us.lumistrips.com/power-led-modules-en/1-10w-single-power-led-modules-us/nichia-ncsu033d-uv-smd-led-on-star-board-800mw-365nm.html) | [Ledrise NVSU233B](https://www.ledrise.eu/what-s-new/nichia-led-nvsu233b-uv-1450mw-365nm.html) |
| Tablette industrielle | À sourcer chez les OEM coque (souvent fournie en kit) | Lenovo Tab M9 / Samsung Galaxy Tab A7 Lite alternatif |
| Optique M12 + filtres | Edmund Optics (qualité) | Aliexpress (économique) |

## Adaptations software à prévoir

L'app Lucens IA actuelle utilise `getUserMedia()` qui prend la caméra par défaut du device. Pour Lucens Inspector :

- [ ] **Sélecteur de caméra** dans Live View : lister toutes les caméras et permettre de choisir manuellement la USB UVC externe
- [ ] **Mode kiosque** Android pour empêcher l'utilisateur d'ouvrir d'autres apps
- [ ] **Adaptation UI 7" 1024×600** : tester chaque écran pour cette résolution exacte
- [ ] **Branding Lucens Inspector** : splash screen custom, logo, version "Pro Hardware"
- [ ] **Détection auto du device Lucens Inspector** via user-agent ou ID hardware → unlock features Pro
- [ ] **Désactivation auto-WB et auto-exposure** sur la caméra USB via UVC controls (paramètres exposés en `getCapabilities()`)

## Prochaines étapes immédiates

1. ✅ **Spec produit rédigée** (ce document)
2. ✅ **RFQ rédigée en anglais** (`docs/lucens-inspector/rfq-suppliers.md`)
3. ⏳ **Envoi RFQ à 3 fournisseurs** : Hangzhou Micron, Shenzhen NNPO, OpticsMaker
4. ⏳ **Réception et comparaison devis** sous 2-3 semaines
5. ⏳ **Commande proto unitaire pour validation interne** (~600-1000€ pour 1 unité)
6. ⏳ **Adaptations PWA** en parallèle (sélecteur caméra, mode kiosque)

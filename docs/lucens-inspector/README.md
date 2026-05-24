# Lucens Inspector — Dossier produit hardware

Date : 2026-05-23
Statut : phase sourcing / RFQ

## Vue d'ensemble

Projet de transformer Lucens IA d'une web app à un **produit hardware professionnel** vendu 2 850€ TTC pour le marché HACCP / hygiène alimentaire.

Format : **caméra-moniteur handheld pistol-grip** (style HIKMICRO Pocket2), avec :
- Module caméra USB UVC 4K (capteur Sony 1/2.8" ou 1/1.8")
- Lampe UV-A 365 nm intégrée (LED Nichia)
- Écran tactile 7" intégré
- App Lucens IA Pro pré-installée
- Trigger physique pour capture

## Fichiers du dossier

| Fichier | Pour qui | Description |
|---|---|---|
| `product-spec.md` | Interne Lucens | Spec produit complète : architecture, BOM, marge, certifications, roadmap industrialisation |
| `rfq-suppliers.md` | À envoyer aux OEM | Request For Quote en anglais, prêt à copier-coller dans un email aux fournisseurs Alibaba |
| `README.md` | Toi | Ce fichier — vue d'ensemble |

## Économie produit

| Élément | Montant |
|---|---|
| Prix vente HT | **2 850€** |
| Coût de revient (BOM + assemblage + QC) | ~400€ |
| Marge brute | 2 450€ (**86%**) |
| Provisions hors-BOM (SAV, certif, formation, support, marketing) | ~700-800€ |
| Marge nette estimée | **~1 650€ / unité (58%)** |

## Fournisseurs validés (à contacter)

### Coque pistolet + écran intégré (OEM Chine)
1. [Hangzhou Micron Control Technology](https://thermalcamera.en.alibaba.com/) — top choix, R&D in-house
2. [Shenzhen NNPO Technology](https://nnpo.en.alibaba.com/) — alternative sérieuse
3. [OpticsMaker](https://www.opticsmaker.com/thermal-monocular-camera/new-handheld-thermal-scopes.html) — custom thermal scopes

### Caméra USB UVC 4K Sony
1. [Arducam IMX678 STARVIS 2 USB 3.0](https://www.arducam.com/arducam-8-3mp-imx678-manual-focus-usb-3-0-camera-module.html) — meilleur low-light
2. [Sinoseen OEM IMX415](https://www.sinoseen.com/usb-camera-module-oem-8mp-imx415-for-high-resolution-industrial-imaging) — économique customisable
3. [e-con Systems e-CAM82_USB IMX415](https://www.e-consystems.com/usb-cameras/sony-imx415-4k-usb-camera.asp) — premium pro avec ISP intégré

### Lampe UV-A 365 nm Nichia
1. [Ledrise NVSU233B 1450 mW](https://www.ledrise.eu/what-s-new/nichia-led-nvsu233b-uv-1450mw-365nm.html) — la plus puissante
2. [Lumistrips NCSU033D 800 mW](https://us.lumistrips.com/power-led-modules-en/1-10w-single-power-led-modules-us/nichia-ncsu033d-uv-smd-led-on-star-board-800mw-365nm.html) — référence industrie
3. [Nichia catalogue UV-A officiel](https://led-ld.nichia.co.jp/en/product/uv_uva.html) — pour spec exacte

## Prochaines étapes

### Immédiat (cette semaine)
1. **Envoyer la RFQ** aux 3 fournisseurs coque pistolet (copier-coller `rfq-suppliers.md` dans email)
2. **Joindre photos de référence** HIKMICRO Pocket2 + InfiRay Tube
3. **Joindre datasheet Nichia NCSU033D** ou NVSU233B
4. **Demander samples** si dispo

### Court terme (2-4 semaines)
5. **Réception des devis** chiffrés (3 fournisseurs)
6. **Comparaison technique + commerciale** → sélection du partenaire OEM principal
7. **Commande proto unitaire** (~600-1000€ acceptable) pour validation interne

### Moyen terme (1-3 mois)
8. **Réception proto** + tests internes Lucens IA en condition réelle
9. **Adaptations software** : sélecteur de caméra USB UVC, mode kiosque Android, branding Lucens Inspector
10. **Mise en certification** : CE marking, photobiologic safety IEC 62471
11. **Commande pilote 50 unités** une fois proto validé

### Long terme (6 mois)
12. **Première production série** 100-300 unités/mois
13. **Lancement commercial** marché HACCP français/européen
14. **Distribution** : vente directe + revendeurs hygiène / QHSE

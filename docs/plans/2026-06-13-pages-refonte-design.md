# Refonte des 4 pages de contenu — Design figé (2026-06-13)

## Périmètre
4 pages, 4 axes (contenu, design, légal, traductions FR/EN/ES/DE), qualité **lancement**.

| Page | Emplacement |
|---|---|
| Confidentialité | `privacy.html` (page séparée) |
| Précautions d'usage | `index.html` — accordéon `data-page="legal"` (~9295) + clés `disclaimer_kp*` |
| Comment ça marche | `index.html` — `data-page="how"` (~9195) + clés `hiw_*` |
| Pourquoi Lucens | `index.html` — `data-page="why"` (~9050) + clés `why_*` |

## Décisions cadre
- **Méthode A** : page par page, en profondeur. FR d'abord → validation → propagation EN/ES/DE. Ordre : **Confidentialité → Précautions → Comment ça marche → Pourquoi Lucens**.
- **Réalité produit** : le « système Lucens » (lampe dédiée + filtre optique + imagerie 4K intégrée + carte de calibration) est **un matériel réel**. Le récit est honnête → on l'assume pleinement, aucune édulcoration.
- **Prestataires** : nommer **Google** (analyse IA) + **Vercel** (hébergement) + mention **transfert hors UE (USA)** encadré par **clauses contractuelles types**.
- **Droits + CNIL** : ajout léger, sans entité juridique.
- **Design** : passe légère (hiérarchie, tokens, cohérence `DESIGN-RULES`) ; pas de refonte visuelle. Si modif visuelle → `audit-design-full.mjs` avant commit.
- **Non-juriste** : rédaction défendable/transparente, relecture pro recommandée avant lancement.

## ⚠️ Blocants lancement (dette légale notée, hors page)
1. **`contact@lucens.com` pas encore créé** — à activer avant toute mise en avant publique, sinon le droit à l'oubli promis est inopérant. En attendant : le formulaire in-app reste le canal valide.
2. **Identité du responsable de traitement** non affichée (choix utilisateur 2026-06-13) — à compléter avant lancement (RGPD art. 13).

## Page 1 — Confidentialité (APPROUVÉE, copie validée par l'utilisateur)
1. **« Qui fait fonctionner Lucens »** réécrite : Google (analyse IA) + Vercel (hébergement) nommés ; paragraphe transfert hors UE / clauses types ; photos non conservées au-delà du traitement.
2. **Nouvelle section « Vos droits »** (avant « Tout faire supprimer ») : accès/rectification/effacement/opposition + code de suppression + saisine CNIL (cnil.fr). Sans entité.
3. Email : texte inchangé (`contact@lucens.com`) ; blocant noté hors page.
4. Resserrage contenu léger + cohérence avec « Précautions » (`disclaimer_kp5`).
5. Propagation EN/ES/DE + parité des clés i18n + `footer_update` (date de révision).

## Pages 2-4 (intention — à détailler à l'ouverture de chaque page)
- **Précautions** : resserrage éditorial des 6 KP ; cohérence avec la nouvelle Confidentialité (conservation, transfert) ; UV-A 365 nm.
- **Comment ça marche** : resserrage des étapes ; matériel réel assumé (lampe/carte).
- **Pourquoi Lucens** : resserrage premium ; section « instrument conçu sur mesure » conservée (réelle).
- Tous : parité traductions FR/EN/ES/DE.

## Vérification
- Pas de régression visuelle (tokens/DESIGN-RULES) ; parité des clés i18n entre les 4 langues ; liens internes (`/privacy.html`) intacts.
- Déploiement : **bump SW** + autorisation utilisateur explicite (cf. protocole).

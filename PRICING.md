# Lucens IA — Structure tarifaire

*Document de référence — dernière mise à jour : 2026-05-08*

---

## 1. Coût de revient par analyse

**Coût Anthropic mesuré (post-optimisations cache 1h + max_tokens cap) :**

| Type d'appel | Coût |
|---|---|
| Cold call (1ère analyse session, ou >1h depuis dernière) | 0.79 € |
| Warm call (cache 1h actif) | 0.20 € |
| **Moyenne pondérée usage pro typique** | **0.27 €/analyse** |

Avant optimisations : 0.42 €/analyse → optimisation = **-36%**.

---

## 2. Abonnements (2 formules, sans Free, sans illimité, 1 utilisateur par compte)

### Lucens Essentiel — 129 €/mois HT
*(990 €/an, économie 17%)*

| Caractéristique | Valeur |
|---|---|
| Analyses incluses | **95 / mois** |
| Surcharge au-delà | 1.50 €/analyse, max +30 |
| Plafond absolu mensuel | **125 analyses** |
| Marge brute (quota plein) | **80%** |
| Marge brute (usage moyen) | **87%** |
| Cible | Inspecteur freelance, petit cabinet |

### Lucens Professionnel — 299 €/mois HT
*(2 490 €/an, économie 17%)*

| Caractéristique | Valeur |
|---|---|
| Analyses incluses | **350 / mois** |
| Surcharge au-delà | 1.20 €/analyse, max +100 |
| Plafond absolu mensuel | **450 analyses** |
| Marge brute (quota plein) | **68%** |
| Marge brute (usage moyen 200) | **82%** |
| Cible | Responsable qualité PME, cabinet d'audit, auditeur sénior |

**Note :** la marge Pro est volontairement réduite à 68% pour offrir un ratio attractif (3.7× analyses pour 2.3× le prix). Marge nette par abonné : 204 €/mois.

---

## 3. Packs à l'unité (validité 12 mois)

| Pack | Analyses | Prix HT | €/analyse | Marge |
|---|---|---|---|---|
| **1** | 1 | **1.99 €** | 1.99 € | 86% |
| **5** | 5 | **8.99 €** | 1.80 € | 85% |
| **10** | 10 | **16.90 €** | 1.69 € | 84% |
| **20** | 20 | **31.90 €** | 1.60 € | 83% |
| **50** | 50 | **75 €** | 1.50 € | 82% |
| **100** | 100 | **139 €** | 1.39 € | 81% |
| **200** | 200 | **270 €** | 1.35 € | 80% |
| **300** | 300 | **405 €** | 1.35 € | 80% |
| **500** | 500 | **675 €** | 1.35 € | 80% |

---

## 4. Bundle hardware + abonnement (à valider)

### Pack Découverte Lucens — 549 € HT (one-time)
- Lampe UV-A 365 nm Lucens (équivalent Fluotechnik VM10/VM30)
- 3 mois d'abonnement Professionnel offerts (valeur 897 €)
- Économie client : 347 € (-39%)
- Marge bundle estimée : 341 € (62%) *avec lampe achetée 120 € OEM*

Après les 3 mois → bascule en abonnement Essentiel (129 €) ou Pro (299 €) selon usage.

---

## 5. Économies d'abonnement vs packs

### Essentiel
| Période | Coût abonnement | Coût packs équivalents | Économie |
|---|---|---|---|
| 1 mois (95 analyses) | 129 € | Pack 100 = 139 € | -7% |
| 12 mois mensuel | 1 548 € | 12 × Pack 100 = 1 668 € | -7% |
| 12 mois annuel | **990 €** | 12 × Pack 100 = 1 668 € | **-41%** |

### Pro
| Période | Coût abonnement | Coût packs équivalents | Économie |
|---|---|---|---|
| 1 mois (350 analyses) | 299 € | Pack 300 + Pack 50 = 480 € | **-38%** |
| 12 mois mensuel | 3 588 € | 12 × 480 = 5 760 € | -38% |
| 12 mois annuel | **2 490 €** | 12 × 480 = 5 760 € | **-57%** |

---

## 6. Logique du funnel

| Profil / Volume mensuel | Choix optimal | Justification |
|---|---|---|
| 1 analyse ponctuelle | Pack 1 à 1.99 € | Test sans engagement |
| 5-30 analyses (1 audit) | Pack 5-50 | Pas de commitment nécessaire |
| 50-95 récurrent | **Essentiel** | Abonnement gagne à partir de ~95 analyses |
| 96-125 récurrent | Essentiel + surcharge | Plafond Essentiel atteint |
| 126-350 récurrent | **Pro** | Tier 1 bloqué à 125, Pro plus avantageux |
| 351-450 récurrent | Pro + surcharge | Plafond Pro étendu |
| 451+ récurrent | Devis enterprise | Hors grille standard |
| 200-500 one-shot | Pack 200-500 | Pas de récurrence nécessaire |

---

## 7. Comparaison concurrence (validation positionnement)

| Solution | Prix mensuel | Analyses | €/analyse |
|---|---|---|---|
| **Lucens Essentiel** | 129 € | 95 | 1.36 € |
| **Lucens Pro** | 299 € | 350 | **0.85 €** |
| FoodDocs Standard | ~199 € | illimité (mais sans IA visuelle) | n/a |
| RizePoint Standard | ~137 € | illimité (sans IA visuelle) | n/a |
| ATP Hygiena (par swab) | abonnement nul | - | 2-3 €/test (sans visuel) |

→ Lucens Pro à 0.85 €/analyse est **3× moins cher qu'un test ATP** avec en plus la visualisation et le PDF d'audit.

---

## 8. Argument RGPD (différenciateur clé)

> Lucens IA traite vos photos en mémoire et vous renvoie le rapport directement. **Aucune image, aucune analyse, aucune donnée d'inspection n'est stockée sur nos serveurs.** Seul votre compteur d'usage et un feedback anonyme optionnel sont conservés.

Différenciateur fort vs concurrents qui stockent en cloud.

---

## 9. Projections de rentabilité 12 mois (estimation)

Hypothèse réaliste :
- 80 ventes Pack Découverte (~7/mois)
- 60% prennent ensuite Essentiel, 30% prennent Pro, 10% churnent
- Volumes réels ~50/mois Essentiel et ~200/mois Pro

| Source revenu | Volume an 1 | Marge nette an 1 |
|---|---|---|
| Packs Découverte (80 × 549 €) | 43 920 € | 27 280 € (62%) |
| Abonnements Essentiel actifs | 28 512 € | 24 800 € (87%) |
| Abonnements Pro actifs (volumes ~200) | 35 856 € | ~28 100 € (78%) |
| Surcharges + packs crédits | ~5 000 € | ~3 750 € (75%) |
| **TOTAL an 1** | **113 288 €** | **~83 930 € marge nette** |

---

## 10. Points à valider / décisions ouvertes

- [ ] Coût d'achat réel de la lampe (OEM) — impacte le prix bundle
- [ ] Conformité CE de la lampe (UV-A 365 nm classe 2) — obligatoire en UE
- [ ] Plateforme de paiement : **Lemon Squeezy** (gère TVA UE) vs Stripe
- [ ] Décision finale sur la marge Pro (68% acceptée pour ratio plus attractif)
- [ ] Validité crédits packs : 12 mois confirmé ?
- [ ] Cumul packs + abonnement : crédits packs s'utilisent en priorité (Option B retenue)

---

## 11. Architecture technique sous-jacente (rappel)

**Pas de modification de l'app actuelle**, seulement gating monétaire à ajouter ultérieurement :
- Système d'auth (magic link recommandé)
- Compteur quota par utilisateur dans Vercel KV (clé `quota:{userId}:{YYYY-MM}`)
- Middleware sur `/api/analyze` qui refuse si quota dépassé
- Webhook Stripe/LemonSqueezy → activation/désactivation compte
- Page pricing intégrée à index.html

**Aucun stockage de données utilisateur** (analyses, photos, historique). Promesse RGPD native.

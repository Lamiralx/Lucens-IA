# Validation Étape 1 — UV-A 365 nm

Ce dossier contient le notebook Colab pour évaluer en 15-20 minutes si tes 50 photos contiennent assez de signal pour entraîner un modèle dédié.

## Quoi faire

1. **Ouvre le notebook dans Google Colab**
   - Va sur https://colab.research.google.com
   - File → Upload notebook → sélectionne `colab_uv_validation.ipynb`

2. **Active le GPU** (gratuit)
   - Runtime → Change runtime type → T4 GPU → Save

3. **Récupère ta clé API Anthropic**
   - https://console.anthropic.com/settings/keys
   - Coût attendu : ~0,50-1 € pour annoter 50 images

4. **Lance Run All**
   - Runtime → Run all
   - Quand demandé, sélectionne tes 50 photos UV
   - Quand demandé, colle ta clé API

5. **Lis le verdict en section 8**
   - Accuracy > 70 % → passe à Étape 2
   - Accuracy 50-70 % → fine-tuning CLIP recommandé
   - Accuracy < 50 % → plus de données ou modèle plus puissant

## Ce que fait le notebook

| Étape | Durée | Sortie |
|---|---|---|
| Pré-annotation Claude | ~5-10 min | `labels_claude.json` |
| Revue visuelle | manuel | corrections optionnelles |
| Embeddings CLIP | ~2 min | vecteurs 768D |
| Linear probe CV-5 | ~30 sec | accuracy + confusion matrix |
| UMAP visualisation | ~30 sec | projection 2D |

## Sorties téléchargées

- `labels_claude.json` — annotations par image
- `clip_embeddings.npz` — embeddings + noms de fichiers

Garde ces fichiers, ils servent pour Étape 2.

## Après le notebook

Envoie-moi :
1. **Le score d'accuracy global** (section 8)
2. **La matrice de confusion** (screenshot)
3. **Le plot UMAP** (screenshot)
4. **La distribution des classes** (combien d'images par catégorie)

Je te dis exactement quoi faire ensuite.

/**
 * Module spectrométrique JS pur pour Lucens IA.
 * Implémente le PRINCIPE de spectrométrie sans hardware dédié :
 *   - Bibliothèque de signatures RGB des fluorophores HACCP connus sous UV-A 365 nm
 *   - Matching probabiliste pixel RGB → identité chimique probable
 *   - Estimation pseudo-quantitative via inversion Beer-Lambert simplifiée
 *
 * Limites :
 *   - Le RGB d'un smartphone = 3 bandes larges, pas un vrai spectre
 *     (un vrai spectro a 100+ bandes étroites)
 *   - L'identification reste probabiliste, pas déterministe
 *   - Les valeurs RGB de référence sont littérature + calibration empirique
 *     (à raffiner via la carte de calibration Lucens en utilisation réelle)
 *
 * Utilisation typique :
 *   import { matchFluorophore, estimateConcentration } from './spectro.js';
 *   const matches = matchFluorophore(r, g, b);
 *   // matches[0] = { name, lambdaEmis, distance, confidence, biology, haccp }
 *
 * Usage côté Lucens IA :
 *   - Pré-classification locale avant envoi Claude (gratuit, instantané)
 *   - Validation croisée du verdict Claude (concordance ou divergence)
 *   - Cartographie Live View "intelligente" (chaque pixel pré-identifié)
 */

/* ─── BIBLIOTHÈQUE DE SIGNATURES FLUOROPHORES ─────────────────────────
   Chaque entrée encode la "fingerprint chromatique" d'un fluorophore
   tel que photographié par un capteur Bayer typique de smartphone sous
   excitation UV-A 365 nm, après auto-white-balance du capteur.
   Sources : littérature spectroscopie de fluorescence + corpus Lucens. */
export const FLUOROPHORE_LIBRARY = [
  {
    id: 'protein_fresh',
    name: 'Protéine fraîche (NADH/NADPH)',
    lambdaEmis: 460,
    rgbRef: [110, 140, 230],
    rgbStd: [22, 28, 30],
    biology: 'Coenzymes NADH/NADPH. Fluorescence endogène protéines fraîches.',
    haccp: 'Viande, œuf cru, fluides bio. Risque MOYEN.',
    category: 'cat_organic',
    hypothesis: 'protein_fresh',
    riskLevel: 'MOYEN',
  },
  {
    id: 'riboflavin_dairy',
    name: 'Riboflavine (vit. B2) — laitages',
    lambdaEmis: 525,
    rgbRef: [200, 215, 90],
    rgbStd: [25, 25, 25],
    biology: 'Coenzyme flavinique. Très fluorescent jaune-vert.',
    haccp: 'Lait, œufs, levures, fromages. Risque FAIBLE en laiterie.',
    category: 'cat_organic',
    hypothesis: 'riboflavin_dairy',
    riskLevel: 'FAIBLE',
  },
  {
    id: 'blood_porphyrins',
    name: 'Sang / Porphyrines',
    lambdaEmis: 635,
    rgbRef: [220, 60, 70],
    rgbStd: [28, 22, 25],
    biology: 'Hème + porphyrines. Sang frais ou séché.',
    haccp: 'Sang sur sol/recoins. Risque CRITIQUE.',
    category: 'cat_pigmented',
    hypothesis: 'blood_porphyrins',
    riskLevel: 'CRITIQUE',
  },
  {
    id: 'rodent_urine',
    name: 'Urine de rongeur',
    lambdaEmis: 405,
    rgbRef: [230, 200, 100],
    rgbStd: [25, 28, 30],
    biology: 'Acide urique + porphyrines (urochromes).',
    haccp: 'Signe direct nuisible. CRITIQUE — action immédiate.',
    category: 'cat_pest',
    hypothesis: 'rodent_urine',
    riskLevel: 'CRITIQUE',
  },
  {
    id: 'detergent_residue',
    name: 'Résidu détergent (azurants optiques)',
    lambdaEmis: 430,
    rgbRef: [130, 180, 250],
    rgbStd: [25, 28, 18],
    biology: 'Stilbenes / azurants. Convertissent UV en bleu visible.',
    haccp: 'Défaut de rinçage. Risque MOYEN.',
    category: 'cat_chemical',
    hypothesis: 'detergent_residue',
    riskLevel: 'MOYEN',
  },
  {
    id: 'mineral_oil',
    name: 'Huile minérale / lubrifiant',
    lambdaEmis: 480,
    rgbRef: [130, 175, 195],
    rgbStd: [30, 28, 32],
    biology: 'Hydrocarbures aromatiques polycycliques (HAP).',
    haccp: 'Lubrifiant machine, fuite hydraulique. CRITIQUE en agro.',
    category: 'cat_chemical',
    hypothesis: 'mineral_oil',
    riskLevel: 'CRITIQUE',
  },
  {
    id: 'cosmetic_uv',
    name: 'Cosmétique / filtres UV',
    lambdaEmis: 440,
    rgbRef: [200, 220, 250],
    rgbStd: [22, 22, 18],
    biology: 'Avobenzone, octocrylène — crème solaire, savon, dentifrice.',
    haccp: 'Traces mains/peau opérateurs. Risque FAIBLE.',
    category: 'cat_cosmetic',
    hypothesis: 'cosmetic_uv',
    riskLevel: 'FAIBLE',
  },
  {
    id: 'biofilm_pseudomonas',
    name: 'Biofilm Pseudomonas',
    lambdaEmis: 510,
    rgbRef: [150, 200, 130],
    rgbStd: [28, 28, 28],
    biology: 'Pyoverdines sécrétées par Pseudomonas spp.',
    haccp: 'Colonisation bactérienne installée. ÉLEVÉ.',
    category: 'cat_biofilm',
    hypothesis: 'biofilm_pseudomonas',
    riskLevel: 'ÉLEVÉ',
  },
  {
    id: 'insect_frass',
    name: 'Frass d\'insectes',
    lambdaEmis: 480,
    rgbRef: [140, 180, 180],
    rgbStd: [28, 28, 28],
    biology: 'Déjections insectes (cafards, blattes).',
    haccp: 'Infestation. Risque ÉLEVÉ.',
    category: 'cat_pest',
    hypothesis: 'insect_frass',
    riskLevel: 'ÉLEVÉ',
  },
  {
    id: 'chlorophyll_plant',
    name: 'Chlorophylle végétale',
    lambdaEmis: 685,
    rgbRef: [180, 50, 50],
    rgbStd: [30, 20, 20],
    biology: 'Pigment photosynthétique végétal.',
    haccp: 'Résidu fruits/légumes. FAIBLE.',
    category: 'cat_pigmented',
    hypothesis: 'chlorophyll_plant',
    riskLevel: 'FAIBLE',
  },
  {
    id: 'mycotoxin_aflatoxin',
    name: 'Aflatoxines (Aspergillus)',
    lambdaEmis: 425,
    rgbRef: [140, 150, 230],
    rgbStd: [22, 22, 25],
    biology: 'Mycotoxines bleu-violet fluo. Aspergillus flavus.',
    haccp: 'Grains, oléagineux. CRITIQUE (cancérigène).',
    category: 'cat_chemical',
    hypothesis: 'mycotoxin_aflatoxin',
    riskLevel: 'CRITIQUE',
  },
  {
    id: 'antibiotic_residue',
    name: 'Résidu antibiotique (tétracyclines/sulfamides)',
    lambdaEmis: 470,
    rgbRef: [180, 200, 130],
    rgbStd: [25, 25, 28],
    biology: 'Tétracyclines, sulfamides vétérinaires.',
    haccp: 'Lait, viande. CRITIQUE (non-conformité réglementaire).',
    category: 'cat_chemical',
    hypothesis: 'antibiotic_residue',
    riskLevel: 'CRITIQUE',
  },
  {
    id: 'stagnant_water',
    name: 'Eau stagnante / résidu de séchage',
    lambdaEmis: 450,
    rgbRef: [170, 200, 210],
    rgbStd: [30, 30, 30],
    biology: 'Voile minéral + matière organique migrée par évaporation.',
    haccp: 'Milieu propice biofilm. ÉLEVÉ.',
    category: 'cat_chemical',
    hypothesis: 'stagnant_water',
    riskLevel: 'ÉLEVÉ',
  },
  {
    id: 'dust_fluorescent',
    name: 'Poussière fluorescente',
    lambdaEmis: 450,
    rgbRef: [180, 195, 220],
    rgbStd: [28, 28, 28],
    biology: 'Microparticules ambiantes, pollen, fibres en suspension.',
    haccp: 'Indication hygiène générale. FAIBLE.',
    category: 'cat_dust',
    hypothesis: 'dust_fluorescent',
    riskLevel: 'FAIBLE',
  },
  {
    id: 'textile_fibers',
    name: 'Fibres textiles / cellulose',
    lambdaEmis: 440,
    rgbRef: [180, 190, 215],
    rgbStd: [25, 25, 25],
    biology: 'Cellulose, coton, plumes/poils kératiniques.',
    haccp: 'Contamination physique. MOYEN.',
    category: 'cat_organic',
    hypothesis: 'textile_fibers',
    riskLevel: 'MOYEN',
  },
];

/* ─── DISTANCE CHROMATIQUE — métrique Mahalanobis simplifiée ───────────
   Distance pondérée par l'écart-type chromatique tolérable de chaque
   signature : un pixel à 1σ de la référence donne distance = 1, à 2σ = 2.
   Plus robuste qu'une distance euclidienne brute car certains pigments
   ont une plus grande variabilité chromatique naturelle. */
function mahalanobisDistance(rgb, ref, std) {
  const dr = (rgb[0] - ref[0]) / std[0];
  const dg = (rgb[1] - ref[1]) / std[1];
  const db = (rgb[2] - ref[2]) / std[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/* ─── MATCH PRINCIPAL — pixel RGB → fluorophore probable ──────────────
   Retourne TOUS les fluorophores triés par distance croissante avec :
   - distance : 0 = match parfait, ≥ 3 = très éloigné
   - confidence : 0-1 dérivée de distance (sigmoïde)
   - rank : position dans le tri (1 = meilleur match)
   L'application décide du seuil (ex: confidence > 0.6 = match utilisable). */
export function matchFluorophore(r, g, b) {
  const rgb = [r, g, b];
  const results = FLUOROPHORE_LIBRARY.map(fp => {
    const dist = mahalanobisDistance(rgb, fp.rgbRef, fp.rgbStd);
    /* Confidence sigmoïde : dist=0 → conf≈1 · dist=2 → conf≈0.5 · dist=4 → conf≈0.1 */
    const confidence = 1 / (1 + Math.exp((dist - 2) * 1.5));
    return {
      id: fp.id,
      name: fp.name,
      lambdaEmis: fp.lambdaEmis,
      category: fp.category,
      biology: fp.biology,
      haccp: fp.haccp,
      distance: +dist.toFixed(3),
      confidence: +confidence.toFixed(3),
    };
  });
  results.sort((a, b) => a.distance - b.distance);
  results.forEach((r, i) => { r.rank = i + 1; });
  return results;
}

/* ─── ESTIMATION CONCENTRATION (Beer-Lambert inversé, pseudo-quantitative) ──
   La loi de Beer-Lambert : A = ε·l·c
   En fluorescence d'émission : I = I0·k·c (linéaire à faible concentration).
   On approxime : intensity_observed = sat·lum / 255
                  concentration_relative = intensity / (ε_ref · I0_ref)
   ε_ref et I0_ref sont calibrés par fluorophore (valeur empirique).
   Sortie : concentration relative 0-1 (1 = saturation visuelle du capteur).
   PAS DE valeur absolue en µg/cm² sans capteur de référence calibré. */
export function estimateRelativeConcentration(r, g, b, fluorophore) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = (r + g + b) / 3;
  const intensity = (sat * lum) / 255;
  /* Calibration empirique par catégorie (à raffiner avec carte Lucens réelle) */
  const epsilonRef = {
    cat_organic:    0.45,
    cat_pigmented:  0.55,
    cat_chemical:   0.35,
    cat_biofilm:    0.40,
    cat_cosmetic:   0.30,
    cat_pest:       0.50,
  };
  const eps = epsilonRef[fluorophore.category] || 0.40;
  return Math.min(1.0, intensity / eps);
}

/* ─── RECONSTRUCTION SPECTRALE PSEUDO (RGB → 6 bandes) ──────────────────
   Approche Wiener simplifiée : à partir de R/G/B et des courbes de
   sensibilité spectrale typiques d'un capteur Bayer, on estime
   l'intensité moyenne dans 6 bandes spectrales effectives :
     B1 = 400-450 nm (violet/bleu profond)
     B2 = 450-500 nm (bleu/cyan)
     B3 = 500-550 nm (vert)
     B4 = 550-600 nm (jaune/orange)
     B5 = 600-650 nm (orange/rouge)
     B6 = 650-700 nm (rouge profond)
   Sortie : tableau de 6 intensités 0-1 (pseudo-spectre).
   Limite : ce n'est PAS une mesure spectrale réelle (3 bandes capteur → 6 bandes
   reconstruites = mathématiquement sous-déterminé), mais c'est un proxy utile
   pour visualiser la signature spectrale dominante du pixel. */
export function pixelToSpectrum(r, g, b) {
  /* Matrice de mixing approximative (capteur Bayer → 6 bandes spectrales).
     Lignes = bandes de sortie, colonnes = R, G, B en entrée.
     Les coefficients sont issus de l'inverse approximative des courbes
     de sensibilité spectrale typiques (Sony IMX, Samsung S5K, etc.). */
  const M = [
    [0.05, 0.15, 0.80],  /* B1 400-450 : dominé par B */
    [0.10, 0.45, 0.55],  /* B2 450-500 : B + un peu de G */
    [0.10, 0.85, 0.15],  /* B3 500-550 : G majoritaire */
    [0.50, 0.45, 0.05],  /* B4 550-600 : G + R */
    [0.80, 0.15, 0.00],  /* B5 600-650 : R majoritaire */
    [0.95, 0.05, 0.00],  /* B6 650-700 : R seul */
  ];
  const rn = r / 255, gn = g / 255, bn = b / 255;
  return M.map(coeffs => +(coeffs[0] * rn + coeffs[1] * gn + coeffs[2] * bn).toFixed(3));
}

/* ─── ANALYSE COMPLÈTE D'UN PIXEL ────────────────────────────────────
   Helper haut-niveau combinant les 3 fonctions précédentes. */
export function analyzePixel(r, g, b) {
  const matches = matchFluorophore(r, g, b);
  const topMatch = matches[0];
  const concentration = estimateRelativeConcentration(r, g, b, topMatch);
  const spectrum = pixelToSpectrum(r, g, b);
  return {
    rgb: [r, g, b],
    topMatch: {
      ...topMatch,
      relativeConcentration: +concentration.toFixed(3),
    },
    alternatives: matches.slice(1, 4),  /* 3 alternatives suivantes */
    pseudoSpectrum: spectrum,
    bands: ['400-450', '450-500', '500-550', '550-600', '600-650', '650-700'],
  };
}

/* ─── ANALYSE D'UNE ZONE (régionMoyenne) ────────────────────────────
   Pour usage cartographie Live View : on prend la moyenne des pixels
   d'une zone détectée, on identifie le fluorophore dominant via matching,
   on retourne le verdict pour cette zone.
   Plus robuste que pixel par pixel (effet médian anti-bruit). */
export function analyzeRegion(imageData, x, y, w, h) {
  const data = imageData.data;
  const width = imageData.width;
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const i = (py * width + px) * 4;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      n++;
    }
  }
  if (n === 0) return null;
  const avgR = Math.round(sumR / n);
  const avgG = Math.round(sumG / n);
  const avgB = Math.round(sumB / n);
  return analyzePixel(avgR, avgG, avgB);
}

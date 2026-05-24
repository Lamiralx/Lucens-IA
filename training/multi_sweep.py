"""
Calibration multi-images : trouve les seuils HSL qui maximisent la performance
moyenne sur PLUSIEURS annotations utilisateur, évitant le surfit sur 1 cas.

Usage :
  1. Mettre tous les JSON v3 d'annotation dans le dossier `annotations/`
  2. Lancer : python3 multi_sweep.py
  3. Le script extrait chaque photo + mask, calcule les métriques par image,
     puis sweepe les paramètres pour optimiser la moyenne pondérée.
"""

import os, sys, io, json, base64
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from calibration import (
    luminance, saturation_basic, hue_basic, hue_distance,
    build_local_background, PATCH_N, compare
)

WORKDIR = os.path.dirname(os.path.abspath(__file__))
ANNOT_DIR = os.path.join(WORKDIR, 'annotations')
EXTRACT_DIR = os.path.join(WORKDIR, 'extracted')
RESULTS_DIR = os.path.join(WORKDIR, 'results')


def detect_v2(img, bg, cfg):
    """Heuristique HSL avec tous les chemins de détection (paramétrables)."""
    H, W = img.shape[:2]
    pw, ph = W / PATCH_N, H / PATCH_N
    py_idx = np.clip((np.arange(H) // ph).astype(int), 0, PATCH_N - 1)
    px_idx = np.clip((np.arange(W) // pw).astype(int), 0, PATCH_N - 1)
    bg_lum = bg[py_idx[:, None], px_idx[None, :], 0]
    bg_sat = bg[py_idx[:, None], px_idx[None, :], 1]
    bg_hue = bg[py_idx[:, None], px_idx[None, :], 2]

    lum = luminance(img).astype(np.float32)
    sat = saturation_basic(img).astype(np.float32)
    hue = hue_basic(img).astype(np.float32)

    reject_spec = (sat < 0.12) & (lum >= 225)
    reject_amb = ((hue >= 220) & (hue <= 280) &
                  (sat >= 0.15) & (sat <= 0.32) &
                  (lum >= 60) & (lum <= 150) &
                  (sat < 0.40))

    fluo_band = ((hue >= 165) & (hue <= 330)) | \
                ((hue >= 45)  & (hue <= 165)) | \
                ((hue >= 0)   & (hue <= 45))  | \
                ((hue >= 320) & (hue <= 360))
    clean_band = ((hue >= 170) & (hue <= 215)) | \
                 ((hue >= 60)  & (hue <= 160)) | \
                 ((hue >= 0)   & (hue <= 30))  | \
                 ((hue >= 320) & (hue <= 360))

    accept_abs = (sat >= cfg['absSat']) & (lum >= cfg['absLum']) & fluo_band

    accept_diff = clean_band & (sat >= cfg['diffSat']) & \
                  (lum >= bg_lum + cfg['diffLumDelta']) & \
                  ((sat - bg_sat) >= cfg['diffSatDelta'])
    anti_amb = (hue_distance(hue, bg_hue) < 12) & ((sat - bg_sat) < 0.12)
    accept_diff = accept_diff & ~anti_amb

    coloured = (sat >= cfg['stdMinSat']) & ((sat - bg_sat) >= cfg['stdSatDelta'])
    white = (sat <= cfg['whiteMaxSat']) & (lum >= cfg['whiteLum']) & (lum >= bg_lum + 70)
    accept_std = (lum >= bg_lum + cfg['stdLumDelta']) & (coloured | white)
    anti_voile = coloured & (hue_distance(hue, bg_hue) < 8) & ((sat - bg_sat) < 0.20)
    accept_std = accept_std & ~anti_voile

    accept_dark = (sat >= cfg['darkSat']) & (lum >= cfg['darkLumMin']) & fluo_band

    accept = accept_abs | accept_diff | accept_std | accept_dark
    accept = accept & ~reject_spec & ~reject_amb
    return accept


def extract_annotations():
    """Extrait toutes les photos + masks des JSON dans annotations/."""
    os.makedirs(EXTRACT_DIR, exist_ok=True)
    cases = []
    if not os.path.isdir(ANNOT_DIR):
        print(f'[!] Dossier {ANNOT_DIR} introuvable. Crée-le et place tes .json dedans.')
        return cases
    files = [f for f in os.listdir(ANNOT_DIR) if f.endswith('.json')]
    if not files:
        print(f'[!] Aucun .json dans {ANNOT_DIR}')
        return cases
    for fname in sorted(files):
        path = os.path.join(ANNOT_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        version = data.get('version')
        if version != 3:
            print(f'[!] {fname} : version {version} (besoin v3 avec photoJpeg)')
            continue
        photo_b64 = data['photoJpeg'].split(',')[1]
        mask_b64 = data['maskPng'].split(',')[1]
        case_id = os.path.splitext(fname)[0]
        photo_path = os.path.join(EXTRACT_DIR, case_id + '_photo.jpg')
        mask_path = os.path.join(EXTRACT_DIR, case_id + '_mask.png')
        with open(photo_path, 'wb') as f:
            f.write(base64.b64decode(photo_b64))
        with open(mask_path, 'wb') as f:
            f.write(base64.b64decode(mask_b64))
        cases.append({
            'id': case_id,
            'photo_path': photo_path,
            'mask_path': mask_path,
            'coverage_pct': data.get('coveragePercent', 0),
        })
    return cases


def evaluate_config(cfg, cases):
    """Évalue une config sur toutes les photos. Renvoie métriques moyennes pondérées."""
    sums = {'tp': 0, 'fp': 0, 'fn': 0}
    per_case = []
    for case in cases:
        photo = np.array(Image.open(case['photo_path']).convert('RGB'))
        mask_user = np.array(Image.open(case['mask_path']).convert('RGBA'))[..., 3]
        bg = build_local_background(photo)
        det = detect_v2(photo, bg, cfg)
        m = compare(mask_user, det)
        sums['tp'] += m['tp']
        sums['fp'] += m['fp']
        sums['fn'] += m['fn']
        per_case.append({'id': case['id'], **m})
    tp, fp, fn = sums['tp'], sums['fp'], sums['fn']
    P = tp / (tp + fp) if (tp + fp) > 0 else 0
    R = tp / (tp + fn) if (tp + fn) > 0 else 0
    IoU = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0
    F1 = 2 * P * R / (P + R) if (P + R) > 0 else 0
    return {
        'precision': round(P, 4),
        'recall': round(R, 4),
        'iou': round(IoU, 4),
        'f1': round(F1, 4),
        'per_case': per_case,
    }


def main():
    cases = extract_annotations()
    if not cases:
        return
    print(f'\n=== CASES EXTRAITS ({len(cases)}) ===')
    for c in cases:
        print(f'  - {c["id"]}  (couverture peinte : {c["coverage_pct"]}%)')

    BASELINE = dict(
        absSat=0.40, absLum=100,
        diffSat=0.20, diffLumDelta=20, diffSatDelta=0.08,
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=30,
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=999, darkLumMin=999,
    )
    PROD_CURRENT = dict(BASELINE)
    PROD_CURRENT['darkSat'] = 0.65
    PROD_CURRENT['darkLumMin'] = 25

    print('\n=== BASELINE ORIGINAL (avant calibration) ===')
    res = evaluate_config(BASELINE, cases)
    print(f'  Aggrege : P={res["precision"]*100:.1f}% R={res["recall"]*100:.1f}% IoU={res["iou"]*100:.1f}% F1={res["f1"]*100:.1f}%')
    for pc in res['per_case']:
        print(f'    {pc["id"][:40]:42s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%')

    print('\n=== PROD ACTUELLE (calibree sur 1 image) ===')
    res = evaluate_config(PROD_CURRENT, cases)
    print(f'  Aggrege : P={res["precision"]*100:.1f}% R={res["recall"]*100:.1f}% IoU={res["iou"]*100:.1f}% F1={res["f1"]*100:.1f}%')
    for pc in res['per_case']:
        print(f'    {pc["id"][:40]:42s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%')

    print('\n=== SWEEP MULTI-IMAGE ===')
    print('Recherche de la config qui maximise F1 GLOBAL sur l\'ensemble...')
    best = (0, None, None)
    tried = 0
    for absLum in [40, 60, 80, 100]:
        for darkSat in [0.55, 0.60, 0.65, 0.70]:
            for darkLum in [20, 25, 30, 35]:
                for stdLumDelta in [25, 30, 35]:
                    cfg = dict(BASELINE)
                    cfg['absLum'] = absLum
                    cfg['darkSat'] = darkSat
                    cfg['darkLumMin'] = darkLum
                    cfg['stdLumDelta'] = stdLumDelta
                    res = evaluate_config(cfg, cases)
                    tried += 1
                    if res['f1'] > best[0]:
                        best = (res['f1'], cfg.copy(), res)
    print(f'  {tried} configs testees')
    print(f'\n  MEILLEURE config (multi-image) :')
    for k, v in best[1].items():
        print(f'    {k}: {v}')
    print(f'\n  Aggrege : P={best[2]["precision"]*100:.1f}% R={best[2]["recall"]*100:.1f}% IoU={best[2]["iou"]*100:.1f}% F1={best[2]["f1"]*100:.1f}%')
    print('  Detail par image :')
    for pc in best[2]['per_case']:
        print(f'    {pc["id"][:40]:42s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%')

    # Sauvegarde
    os.makedirs(RESULTS_DIR, exist_ok=True)
    with open(os.path.join(RESULTS_DIR, 'multi_optimal.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'config': best[1],
            'aggregate_metrics': {
                'precision': best[2]['precision'],
                'recall': best[2]['recall'],
                'iou': best[2]['iou'],
                'f1': best[2]['f1'],
            },
            'per_case': best[2]['per_case'],
            'n_cases': len(cases),
        }, f, indent=2, ensure_ascii=False)
    print(f'\n  Resultats sauves : {os.path.join(RESULTS_DIR, "multi_optimal.json")}')


if __name__ == '__main__':
    main()

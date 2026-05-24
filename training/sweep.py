"""
Sweep de paramètres : recherche les seuils HSL optimaux qui maximisent
IoU et Recall vs l'annotation utilisateur, sans sacrifier la précision.
"""

import os, sys, io, json
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from calibration import (
    luminance, saturation_basic, hue_basic, hue_distance,
    build_local_background, PATCH_N, compare
)

# UTF-8 sortie compatible Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')


def detect_v2(img, bg, cfg):
    """Version étendue : ajoute un chemin 'fluo saturée en zone sombre' pour
    récupérer les vraies fluorescences en cavité (intérieur tube, ombres)."""
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

    # Filtres de rejet
    reject_spec = (sat < 0.12) & (lum >= 225)
    reject_amb = ((hue >= 220) & (hue <= 280) &
                  (sat >= 0.15) & (sat <= 0.32) &
                  (lum >= 60) & (lum <= 150) &
                  (sat < 0.40))

    # Bandes fluo
    fluo_band = ((hue >= 165) & (hue <= 330)) | \
                ((hue >= 45)  & (hue <= 165)) | \
                ((hue >= 0)   & (hue <= 45))  | \
                ((hue >= 320) & (hue <= 360))
    clean_band = ((hue >= 170) & (hue <= 215)) | \
                 ((hue >= 60)  & (hue <= 160)) | \
                 ((hue >= 0)   & (hue <= 30))  | \
                 ((hue >= 320) & (hue <= 360))

    # Path 1 : fluo absolu
    accept_abs = (sat >= cfg['absSat']) & (lum >= cfg['absLum']) & fluo_band

    # Path 2 : voie diffuse
    accept_diff = clean_band & (sat >= cfg['diffSat']) & \
                  (lum >= bg_lum + cfg['diffLumDelta']) & \
                  ((sat - bg_sat) >= cfg['diffSatDelta'])
    anti_amb = (hue_distance(hue, bg_hue) < 12) & ((sat - bg_sat) < 0.12)
    accept_diff = accept_diff & ~anti_amb

    # Path 3 : voie standard
    coloured = (sat >= cfg['stdMinSat']) & ((sat - bg_sat) >= cfg['stdSatDelta'])
    white = (sat <= cfg['whiteMaxSat']) & (lum >= cfg['whiteLum']) & (lum >= bg_lum + 70)
    accept_std = (lum >= bg_lum + cfg['stdLumDelta']) & (coloured | white)
    anti_voile = coloured & (hue_distance(hue, bg_hue) < 8) & ((sat - bg_sat) < 0.20)
    accept_std = accept_std & ~anti_voile

    # NOUVEAU PATH 4 : fluo saturée en zone SOMBRE (cavité, intérieur tube)
    # Capture les vraies fluo qui sont dark mais très saturées dans bande fluo
    accept_dark = (sat >= cfg['darkSat']) & (lum >= cfg['darkLumMin']) & fluo_band

    accept = accept_abs | accept_diff | accept_std | accept_dark
    accept = accept & ~reject_spec & ~reject_amb
    return accept


def main():
    workdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'calibration_workdir')
    photo = np.array(Image.open(os.path.join(workdir, 'photo.jpg')).convert('RGB'))
    mask_user = np.array(Image.open(os.path.join(workdir, 'mask.png')).convert('RGBA'))[..., 3]

    bg = build_local_background(photo)

    # Config baseline (config actuelle JS)
    baseline = dict(
        absSat=0.40, absLum=100,
        diffSat=0.20, diffLumDelta=20, diffSatDelta=0.08,
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=30,
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=999, darkLumMin=999,  # path désactivé
    )

    # Sweep : on teste différentes valeurs pour les paramètres clés
    print('=== BASELINE (config actuelle) ===')
    det = detect_v2(photo, bg, baseline)
    m = compare(mask_user, det)
    print(f'  Precision: {m["precision"]*100:.1f}%   Recall: {m["recall"]*100:.1f}%   IoU: {m["iou"]*100:.1f}%   F1: {m["f1"]*100:.1f}%')

    print('\n=== SWEEP : ajustement progressif des seuils ===')
    print('Test 1 : abaisser absLum (capter fluo saturée en zone sombre via path absolu)')
    for absLum in [100, 80, 60, 40, 20]:
        cfg = dict(baseline); cfg['absLum'] = absLum
        det = detect_v2(photo, bg, cfg)
        m = compare(mask_user, det)
        print(f'  absLum={absLum:3d}  P={m["precision"]*100:5.1f}% R={m["recall"]*100:5.1f}% IoU={m["iou"]*100:5.1f}% F1={m["f1"]*100:5.1f}%')

    print('\nTest 2 : ajout path "dark fluo" (sat élevée + lum bas)')
    for darkSat in [0.45, 0.50, 0.55, 0.60, 0.65]:
        for darkLum in [15, 25, 35]:
            cfg = dict(baseline); cfg['darkSat'] = darkSat; cfg['darkLumMin'] = darkLum
            det = detect_v2(photo, bg, cfg)
            m = compare(mask_user, det)
            print(f'  darkSat={darkSat} darkLum={darkLum:3d}  P={m["precision"]*100:5.1f}% R={m["recall"]*100:5.1f}% IoU={m["iou"]*100:5.1f}% F1={m["f1"]*100:5.1f}%')

    print('\nTest 3 : combiner abaissement absLum + path dark')
    best = None
    for absLum in [100, 80, 60, 40]:
        for darkSat in [0.50, 0.55, 0.60]:
            for darkLum in [15, 25, 35]:
                cfg = dict(baseline)
                cfg['absLum'] = absLum
                cfg['darkSat'] = darkSat
                cfg['darkLumMin'] = darkLum
                det = detect_v2(photo, bg, cfg)
                m = compare(mask_user, det)
                if best is None or m['f1'] > best[0]:
                    best = (m['f1'], cfg.copy(), m)
    print(f'  MEILLEURE config trouvée:')
    print(f'  {best[1]}')
    print(f'  Metriques: P={best[2]["precision"]*100:.1f}% R={best[2]["recall"]*100:.1f}% IoU={best[2]["iou"]*100:.1f}% F1={best[2]["f1"]*100:.1f}%')

    # Sauvegarde l'image de comparaison avec la meilleure config
    det = detect_v2(photo, bg, best[1])
    user_bool = mask_user > 30
    out = (photo.astype(np.float32) * 0.4).astype(np.uint8)
    out[user_bool & det] = [40, 220, 100]
    out[~user_bool & det] = [80, 130, 255]
    out[user_bool & ~det] = [255, 60, 80]
    Image.fromarray(out).save(os.path.join(workdir, 'compare_optimal.png'))
    print(f'\n  -> Image: {os.path.join(workdir, "compare_optimal.png")}')

    # Sauve la config optimale
    with open(os.path.join(workdir, 'optimal_config.json'), 'w', encoding='utf-8') as f:
        json.dump({'config': best[1], 'metrics': best[2]}, f, indent=2)


if __name__ == '__main__':
    main()

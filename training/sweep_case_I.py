"""
Sweep ciblé pour améliorer case_I (panneau ascenseur LED) sans dégrader
les 8 autres cas. Test de nouveaux chemins de détection en ajoutant un
"path halo modéré" pour bande red-orange-magenta.
"""

import os, sys, json, base64
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from calibration import (
    luminance, saturation_basic, hue_basic, hue_distance,
    build_local_background, PATCH_N, compare
)
from multi_sweep import extract_annotations

WORKDIR = os.path.dirname(os.path.abspath(__file__))


def detect_v3(img, bg, cfg):
    """Comme detect_v2 mais ajoute un chemin 'haloModerate' pour les halos
    modérément saturés en bande red-orange-magenta (typique LED, sang,
    porphyrines, certains résidus organiques)."""
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

    # NOUVEAU PATH : halo modéré bande red-orange-magenta
    halo_band = ((hue >= 0) & (hue <= 30)) | ((hue >= 320) & (hue <= 360))
    accept_halo = halo_band & (sat >= cfg['haloSat']) & (lum >= cfg['haloLum']) & \
                  ((sat - bg_sat) >= cfg.get('haloSatDelta', 0.05))

    accept = accept_abs | accept_diff | accept_std | accept_dark | accept_halo
    accept = accept & ~reject_spec & ~reject_amb
    return accept


def evaluate_on_cases(cfg, cases, precomputed):
    sums = {'tp': 0, 'fp': 0, 'fn': 0}
    per_case = []
    for case, pre in zip(cases, precomputed):
        det = detect_v3(pre['photo'], pre['bg'], cfg)
        m = compare(pre['mask_user'], det)
        sums['tp'] += m['tp']; sums['fp'] += m['fp']; sums['fn'] += m['fn']
        per_case.append({'id': case['id'], **m})
    tp, fp, fn = sums['tp'], sums['fp'], sums['fn']
    P = tp / (tp + fp) if (tp + fp) > 0 else 0
    R = tp / (tp + fn) if (tp + fn) > 0 else 0
    IoU = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0
    F1 = 2 * P * R / (P + R) if (P + R) > 0 else 0
    return {'precision': P, 'recall': R, 'iou': IoU, 'f1': F1, 'per_case': per_case}


def main():
    cases = extract_annotations()
    print(f'CAS : {len(cases)}', flush=True)

    print('Pré-chargement (downscale max 1024px)...', flush=True)
    precomputed = []
    for c in cases:
        img = Image.open(c['photo_path']).convert('RGB')
        mask_img = Image.open(c['mask_path']).convert('RGBA')
        if max(img.width, img.height) > 1024:
            ratio = 1024 / max(img.width, img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            mask_img = mask_img.resize(new_size, Image.LANCZOS)
        precomputed.append({
            'photo': np.array(img),
            'mask_user': np.array(mask_img)[..., 3],
            'bg': build_local_background(np.array(img)),
        })

    BASE = dict(
        absSat=0.40, absLum=100,
        diffSat=0.20, diffLumDelta=20, diffSatDelta=0.08,
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=12,  # vrai prod
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=0.55, darkLumMin=30,
        haloSat=999, haloLum=999, haloSatDelta=0.05,  # path désactivé
    )

    print('\n=== PROD ACTUELLE (sans halo path) ===', flush=True)
    res = evaluate_on_cases(BASE, cases, precomputed)
    print(f'  Aggrege: P={res["precision"]*100:.1f}%  R={res["recall"]*100:.1f}%  IoU={res["iou"]*100:.1f}%  F1={res["f1"]*100:.1f}%', flush=True)
    for pc in res['per_case']:
        print(f'    {pc["id"][:50]:52s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%', flush=True)

    print('\n=== SWEEP HALO PATH (red-orange-magenta) ===', flush=True)
    best = (res['f1'], dict(BASE), res, 'baseline')
    cnt = 0
    for haloSat in [0.25, 0.30, 0.35, 0.40, 0.45]:
        for haloLum in [40, 60, 80, 100]:
            for haloSatDelta in [0.04, 0.08, 0.12]:
                cfg = dict(BASE)
                cfg['haloSat'] = haloSat
                cfg['haloLum'] = haloLum
                cfg['haloSatDelta'] = haloSatDelta
                res = evaluate_on_cases(cfg, cases, precomputed)
                cnt += 1
                if res['f1'] > best[0]:
                    best = (res['f1'], cfg.copy(), res, f'halo {haloSat}/{haloLum}/{haloSatDelta}')
                if cnt % 15 == 0:
                    print(f'  {cnt}/60 testees, best F1 = {best[0]*100:.1f}% ({best[3]})', flush=True)

    print(f'\n=== MEILLEURE CONFIG ({best[3]}) ===', flush=True)
    print(f'  haloSat={best[1]["haloSat"]} haloLum={best[1]["haloLum"]} haloSatDelta={best[1]["haloSatDelta"]}', flush=True)
    print(f'  Aggrege: P={best[2]["precision"]*100:.1f}%  R={best[2]["recall"]*100:.1f}%  IoU={best[2]["iou"]*100:.1f}%  F1={best[2]["f1"]*100:.1f}%', flush=True)
    for pc in best[2]['per_case']:
        print(f'    {pc["id"][:50]:52s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%', flush=True)


if __name__ == '__main__':
    main()

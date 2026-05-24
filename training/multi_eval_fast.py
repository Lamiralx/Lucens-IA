"""
Évaluation rapide multi-images : compare 3 configs (baseline, prod actuelle,
sweep ciblé) sur toutes les annotations. Optimisé pour vitesse.
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
from multi_sweep import detect_v2, extract_annotations

WORKDIR = os.path.dirname(os.path.abspath(__file__))


def evaluate_on_cases(cfg, cases, precomputed):
    """Évalue config sur cas pré-calculés (évite recalcul des bg)."""
    sums = {'tp': 0, 'fp': 0, 'fn': 0}
    per_case = []
    for case, pre in zip(cases, precomputed):
        det = detect_v2(pre['photo'], pre['bg'], cfg)
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

    # Pré-chargement avec downscale (les photos 4K prennent trop de RAM)
    print('\nPré-chargement (downscale max 1024px pour vitesse)...', flush=True)
    precomputed = []
    for c in cases:
        img = Image.open(c['photo_path']).convert('RGB')
        mask_img = Image.open(c['mask_path']).convert('RGBA')
        # Downscale à max 1024 pour la calibration
        max_side = max(img.width, img.height)
        if max_side > 1024:
            ratio = 1024 / max_side
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            mask_img = mask_img.resize(new_size, Image.LANCZOS)
        photo = np.array(img)
        mask_user = np.array(mask_img)[..., 3]
        bg = build_local_background(photo)
        precomputed.append({'photo': photo, 'mask_user': mask_user, 'bg': bg})
        print(f'  {c["id"][:50]:52s}  {photo.shape[1]}x{photo.shape[0]}', flush=True)

    BASELINE = dict(
        absSat=0.40, absLum=100,
        diffSat=0.20, diffLumDelta=20, diffSatDelta=0.08,
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=30,
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=999, darkLumMin=999,
    )
    PROD_CURRENT = dict(BASELINE); PROD_CURRENT['darkSat'] = 0.65; PROD_CURRENT['darkLumMin'] = 25

    print('\n=== BASELINE (avant calibration) ===')
    res = evaluate_on_cases(BASELINE, cases, precomputed)
    print(f'  Aggrege: P={res["precision"]*100:5.1f}%  R={res["recall"]*100:5.1f}%  IoU={res["iou"]*100:5.1f}%  F1={res["f1"]*100:5.1f}%')
    for pc in res['per_case']:
        print(f'    {pc["id"][:50]:52s}  R={pc["recall"]*100:5.1f}%  IoU={pc["iou"]*100:5.1f}%')

    print('\n=== PROD ACTUELLE (1 image calibrée) ===')
    res = evaluate_on_cases(PROD_CURRENT, cases, precomputed)
    print(f'  Aggrege: P={res["precision"]*100:5.1f}%  R={res["recall"]*100:5.1f}%  IoU={res["iou"]*100:5.1f}%  F1={res["f1"]*100:5.1f}%')
    for pc in res['per_case']:
        print(f'    {pc["id"][:50]:52s}  R={pc["recall"]*100:5.1f}%  IoU={pc["iou"]*100:5.1f}%')

    print('\n=== SWEEP CIBLÉ (sur les 4 paramètres clés) ===')
    best = (0, None, None)
    cnt = 0
    for absLum in [40, 60, 80, 100]:
        for darkSat in [0.55, 0.60, 0.65, 0.70]:
            for darkLum in [20, 25, 30]:
                for stdLumDelta in [25, 30]:
                    cfg = dict(BASELINE)
                    cfg['absLum'] = absLum
                    cfg['darkSat'] = darkSat
                    cfg['darkLumMin'] = darkLum
                    cfg['stdLumDelta'] = stdLumDelta
                    res = evaluate_on_cases(cfg, cases, precomputed)
                    cnt += 1
                    if res['f1'] > best[0]:
                        best = (res['f1'], cfg.copy(), res)
                    if cnt % 10 == 0:
                        print(f'  {cnt}/96 testees, best F1 = {best[0]*100:.1f}%')

    print(f'\n=== MEILLEURE CONFIG MULTI-IMAGE ===')
    print(f'  absSat={best[1]["absSat"]} absLum={best[1]["absLum"]}')
    print(f'  darkSat={best[1]["darkSat"]} darkLum={best[1]["darkLumMin"]}')
    print(f'  stdMinSat={best[1]["stdMinSat"]} stdSatDelta={best[1]["stdSatDelta"]} stdLumDelta={best[1]["stdLumDelta"]}')
    print(f'  diffSat={best[1]["diffSat"]} diffLumDelta={best[1]["diffLumDelta"]} diffSatDelta={best[1]["diffSatDelta"]}')
    print(f'  whiteMaxSat={best[1]["whiteMaxSat"]} whiteLum={best[1]["whiteLum"]}')
    print(f'\n  Aggrege: P={best[2]["precision"]*100:5.1f}%  R={best[2]["recall"]*100:5.1f}%  IoU={best[2]["iou"]*100:5.1f}%  F1={best[2]["f1"]*100:5.1f}%')
    for pc in best[2]['per_case']:
        print(f'    {pc["id"][:50]:52s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%')

    os.makedirs(os.path.join(WORKDIR, 'results'), exist_ok=True)
    with open(os.path.join(WORKDIR, 'results', 'multi_optimal.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'config': best[1],
            'aggregate': {k: round(v, 4) for k, v in best[2].items() if k != 'per_case'},
            'per_case': [{**pc, 'precision': round(pc['precision'], 4), 'recall': round(pc['recall'], 4), 'iou': round(pc['iou'], 4)} for pc in best[2]['per_case']],
            'n_cases': len(cases),
        }, f, indent=2, ensure_ascii=False)


if __name__ == '__main__':
    main()

"""
Sweep agressif : pousse les seuils halo très bas pour booster case_I,
en regardant si la précision sur les autres cas tient le coup.
"""

import os, sys, json
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from calibration import build_local_background, compare
from multi_sweep import extract_annotations
from sweep_case_I import detect_v3

WORKDIR = os.path.dirname(os.path.abspath(__file__))


def evaluate(cfg, cases, precomputed):
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
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=12,
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=0.55, darkLumMin=30,
        haloSat=999, haloLum=999, haloSatDelta=0.05,
    )

    print('=== SWEEP AGRESSIF HALO + DARK ===', flush=True)
    best_overall = (0, None, None)
    best_caseI = (0, None, None)
    cnt = 0
    for haloSat in [0.18, 0.22, 0.26, 0.30, 0.35]:
        for haloLum in [30, 50, 70, 90]:
            for haloSatDelta in [0.04, 0.08, 0.12]:
                for darkSat in [0.45, 0.50, 0.55]:
                    cfg = dict(BASE)
                    cfg['haloSat'] = haloSat
                    cfg['haloLum'] = haloLum
                    cfg['haloSatDelta'] = haloSatDelta
                    cfg['darkSat'] = darkSat
                    res = evaluate(cfg, cases, precomputed)
                    cnt += 1
                    if res['f1'] > best_overall[0]:
                        best_overall = (res['f1'], cfg.copy(), res)
                    case_i_iou = next((pc['iou'] for pc in res['per_case']
                                       if 'panneau_ascenseur' in pc['id']), 0)
                    if case_i_iou > best_caseI[0]:
                        best_caseI = (case_i_iou, cfg.copy(), res)
                    if cnt % 30 == 0:
                        print(f'  {cnt}/180  bestF1={best_overall[0]*100:.1f}%  bestCaseI={best_caseI[0]*100:.1f}%', flush=True)

    print(f'\n=== MEILLEUR F1 GLOBAL ===', flush=True)
    print(f'  haloSat={best_overall[1]["haloSat"]} haloLum={best_overall[1]["haloLum"]} haloSatDelta={best_overall[1]["haloSatDelta"]} darkSat={best_overall[1]["darkSat"]}', flush=True)
    print(f'  Aggrege: P={best_overall[2]["precision"]*100:.1f}% R={best_overall[2]["recall"]*100:.1f}% IoU={best_overall[2]["iou"]*100:.1f}% F1={best_overall[2]["f1"]*100:.1f}%', flush=True)
    for pc in best_overall[2]['per_case']:
        print(f'    {pc["id"][:50]:52s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%', flush=True)

    print(f'\n=== MEILLEUR IoU CASE_I ===', flush=True)
    print(f'  haloSat={best_caseI[1]["haloSat"]} haloLum={best_caseI[1]["haloLum"]} haloSatDelta={best_caseI[1]["haloSatDelta"]} darkSat={best_caseI[1]["darkSat"]}', flush=True)
    print(f'  Aggrege: P={best_caseI[2]["precision"]*100:.1f}% R={best_caseI[2]["recall"]*100:.1f}% IoU={best_caseI[2]["iou"]*100:.1f}% F1={best_caseI[2]["f1"]*100:.1f}%', flush=True)
    for pc in best_caseI[2]['per_case']:
        print(f'    {pc["id"][:50]:52s}  P={pc["precision"]*100:5.1f}% R={pc["recall"]*100:5.1f}% IoU={pc["iou"]*100:5.1f}%', flush=True)


if __name__ == '__main__':
    main()

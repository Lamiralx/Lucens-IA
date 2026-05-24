"""
Diagnostique précis sur UN cas spécifique : extrait stats fines pour comprendre
ce qui ne marche pas (pixels mal classés, distribution HSL, etc.).

Usage : python3 diagnose_case.py case_I_panneau_ascenseur_led
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
from multi_sweep import detect_v2

WORKDIR = os.path.dirname(os.path.abspath(__file__))


def load_case(case_id):
    path = os.path.join(WORKDIR, 'annotations', case_id + '.json')
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    photo_b64 = data['photoJpeg'].split(',')[1]
    mask_b64 = data['maskPng'].split(',')[1]
    extract_dir = os.path.join(WORKDIR, 'extracted')
    os.makedirs(extract_dir, exist_ok=True)
    p_path = os.path.join(extract_dir, case_id + '_photo.jpg')
    m_path = os.path.join(extract_dir, case_id + '_mask.png')
    with open(p_path, 'wb') as f: f.write(base64.b64decode(photo_b64))
    with open(m_path, 'wb') as f: f.write(base64.b64decode(mask_b64))

    img = Image.open(p_path).convert('RGB')
    mask_img = Image.open(m_path).convert('RGBA')
    if max(img.width, img.height) > 1024:
        ratio = 1024 / max(img.width, img.height)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        mask_img = mask_img.resize(new_size, Image.LANCZOS)
    photo = np.array(img)
    mask_user = np.array(mask_img)[..., 3]
    return photo, mask_user, data


def make_compare_image(photo, mask_user, mask_detected, out_path):
    user_bool = mask_user > 30
    out = (photo.astype(np.float32) * 0.4).astype(np.uint8)
    out[user_bool & mask_detected] = [40, 220, 100]   # green TP
    out[~user_bool & mask_detected] = [80, 130, 255]  # blue FP
    out[user_bool & ~mask_detected] = [255, 60, 80]   # red FN
    Image.fromarray(out).save(out_path)


def diagnose(case_id):
    photo, mask_user, raw = load_case(case_id)
    H, W = photo.shape[:2]
    print(f'\n=== CAS : {case_id} ===')
    print(f'  Dimensions : {W}x{H}')
    print(f'  Couverture peinte : {raw.get("coveragePercent")}%')
    print(f'  Zones estimées : {raw.get("connectedZonesEstimate")}')

    # Analyse HSL des pixels peints (zones de référence)
    user_bool = mask_user > 30
    n_painted = np.sum(user_bool)
    if n_painted == 0:
        print('  [!] Aucun pixel peint, abandon')
        return

    lum = luminance(photo).astype(np.float32)
    sat = saturation_basic(photo).astype(np.float32)
    hue = hue_basic(photo).astype(np.float32)

    print(f'\n  STATS HSL DES PIXELS PEINTS PAR L UTILISATEUR :')
    print(f'    n_pixels = {n_painted} ({n_painted / user_bool.size * 100:.1f}%)')
    print(f'    luminance  : min={lum[user_bool].min():.0f}  median={np.median(lum[user_bool]):.0f}  max={lum[user_bool].max():.0f}')
    print(f'    saturation : min={sat[user_bool].min():.2f}  median={np.median(sat[user_bool]):.2f}  max={sat[user_bool].max():.2f}')
    print(f'    hue        : médiane={np.median(hue[user_bool]):.0f}°')
    h_painted = hue[user_bool]
    print(f'    hue distribution :')
    for low, high, name in [
        (0, 30, 'rouge-orange'),
        (30, 60, 'orange-jaune'),
        (60, 120, 'vert'),
        (120, 180, 'vert-cyan'),
        (180, 220, 'cyan'),
        (220, 280, 'bleu-violet'),
        (280, 320, 'violet-magenta'),
        (320, 360, 'magenta-rouge'),
    ]:
        n = np.sum((h_painted >= low) & (h_painted < high))
        if n > 0:
            print(f'      [{low:3d}-{high:3d}°] {name:20s} : {n} pixels ({n/n_painted*100:.1f}%)')

    # Détection prod actuelle
    PROD = dict(
        absSat=0.40, absLum=100,
        diffSat=0.20, diffLumDelta=20, diffSatDelta=0.08,
        stdMinSat=0.18, stdSatDelta=0.08, stdLumDelta=12,  # prod a 12, pas 30
        whiteMaxSat=0.18, whiteLum=200,
        darkSat=0.55, darkLumMin=30,
    )
    bg = build_local_background(photo)
    det = detect_v2(photo, bg, PROD)
    m = compare(mask_user, det)
    print(f'\n  PROD ACTUELLE :')
    print(f'    P={m["precision"]*100:.1f}% R={m["recall"]*100:.1f}% IoU={m["iou"]*100:.1f}% F1={m["f1"]*100:.1f}%')

    # Analyse des FAUX NÉGATIFS (zones peintes mais ratées)
    fn_mask = user_bool & ~det
    n_fn = np.sum(fn_mask)
    if n_fn > 0:
        print(f'\n  FAUX NÉGATIFS (peints mais ratés) : {n_fn} pixels ({n_fn/user_bool.size*100:.1f}%)')
        print(f'    Stats HSL des FN :')
        print(f'      luminance  : median={np.median(lum[fn_mask]):.0f}  range={lum[fn_mask].min():.0f}-{lum[fn_mask].max():.0f}')
        print(f'      saturation : median={np.median(sat[fn_mask]):.2f}  range={sat[fn_mask].min():.2f}-{sat[fn_mask].max():.2f}')
        print(f'      hue median : {np.median(hue[fn_mask]):.0f}°')

    # Sauvegarde comparaison visuelle
    out_path = os.path.join(WORKDIR, 'extracted', case_id + '_compare.png')
    make_compare_image(photo, mask_user, det, out_path)
    print(f'\n  -> {out_path}')
    print('     vert=correct (TP), rouge=raté (FN), bleu=faux positif (FP)')


if __name__ == '__main__':
    case_id = sys.argv[1] if len(sys.argv) > 1 else 'case_I_panneau_ascenseur_led'
    diagnose(case_id)

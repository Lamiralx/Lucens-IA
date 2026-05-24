"""
Outil de calibration heuristique HSL — compare la détection du système Lucens
avec un mask d'annotation utilisateur (vérité terrain) pour identifier les
seuils HSL qui ratent les vraies zones et ceux qui captent du bruit.

Réplique fidèle de la logique testPixel() de index.html (Lucens IA front-end).
Aucun appel API Anthropic.
"""

import json
import base64
import os
import sys
import io
import numpy as np
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

WORKDIR = os.path.dirname(os.path.abspath(__file__))


# ─── Conversion couleur (réplique de rgbToHsl côté JS) ──────────────────
def rgb_to_hsl(rgb):
    """rgb : array (..., 3) uint8 → renvoie h (0-360), s (0-1), l (0-1)."""
    r = rgb[..., 0].astype(np.float32) / 255.0
    g = rgb[..., 1].astype(np.float32) / 255.0
    b = rgb[..., 2].astype(np.float32) / 255.0
    cmax = np.max(rgb[..., :3], axis=-1) / 255.0
    cmin = np.min(rgb[..., :3], axis=-1) / 255.0
    delta = cmax - cmin
    L = (cmax + cmin) / 2.0
    S = np.where(delta == 0, 0.0,
                 delta / np.where(L < 0.5, cmax + cmin, 2.0 - cmax - cmin))
    H = np.zeros_like(L)
    eps = 1e-9
    mask_r = (cmax == r) & (delta > 0)
    mask_g = (cmax == g) & (delta > 0)
    mask_b = (cmax == b) & (delta > 0)
    H = np.where(mask_r, ((g - b) / (delta + eps)) % 6, H)
    H = np.where(mask_g, (b - r) / (delta + eps) + 2, H)
    H = np.where(mask_b, (r - g) / (delta + eps) + 4, H)
    H = (H * 60.0) % 360.0
    return H, S, L


def luminance(rgb):
    """Luminance perçue (Y' BT.601) en 0-255, comme côté JS."""
    return (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])


def saturation_basic(rgb):
    """Saturation = (max - min) / max, sur 0-1."""
    cmax = np.max(rgb[..., :3], axis=-1).astype(np.float32)
    cmin = np.min(rgb[..., :3], axis=-1).astype(np.float32)
    return np.where(cmax > 0, (cmax - cmin) / np.where(cmax > 0, cmax, 1), 0.0)


def hue_basic(rgb):
    """Hue 0-360 (différent de HSL.H ? Non, c'est le même calcul)."""
    H, _, _ = rgb_to_hsl(rgb)
    return H


# ─── Fond local : moyenne sur grille patches PATCH_N × PATCH_N ───────────
PATCH_N = 8


def build_local_background(img):
    """Renvoie pour chaque patch (px,py) → {lum, sat, hue}."""
    H, W = img.shape[:2]
    pw, ph = W / PATCH_N, H / PATCH_N
    bg = np.zeros((PATCH_N, PATCH_N, 3), dtype=np.float32)  # lum, sat, hue
    for py in range(PATCH_N):
        for px in range(PATCH_N):
            x0 = int(px * pw); x1 = int((px + 1) * pw)
            y0 = int(py * ph); y1 = int((py + 1) * ph)
            patch = img[y0:y1, x0:x1]
            lum = luminance(patch).flatten()
            sat = saturation_basic(patch).flatten()
            # Hue circular mean
            hue_rad = hue_basic(patch).flatten() * np.pi / 180
            cosH = np.mean(np.cos(hue_rad))
            sinH = np.mean(np.sin(hue_rad))
            hue_mean = (np.degrees(np.arctan2(sinH, cosH)) + 360) % 360
            bg[py, px, 0] = np.mean(lum)
            bg[py, px, 1] = np.mean(sat)
            bg[py, px, 2] = hue_mean
    return bg


def hue_distance(a, b):
    d = np.abs(a - b) % 360
    return np.minimum(d, 360 - d)


# ─── testPixel — réplique exacte du JS ─────────────────────────────────
def detect_fluorescent_pixels(img, bg, cfg):
    """
    Renvoie un mask bool (H,W) True = pixel détecté comme fluorescent.
    Cfg : dict avec minSaturation, saturationDelta, luminanceDelta,
                whiteMaxSat, whiteLuminance.
    """
    H, W = img.shape[:2]
    pw, ph = W / PATCH_N, H / PATCH_N
    # Pour chaque pixel, retrouve son patch bg
    py_idx = np.clip((np.arange(H) // ph).astype(int), 0, PATCH_N - 1)
    px_idx = np.clip((np.arange(W) // pw).astype(int), 0, PATCH_N - 1)
    bg_lum = bg[py_idx[:, None], px_idx[None, :], 0]
    bg_sat = bg[py_idx[:, None], px_idx[None, :], 1]
    bg_hue = bg[py_idx[:, None], px_idx[None, :], 2]

    lum = luminance(img).astype(np.float32)
    sat = saturation_basic(img).astype(np.float32)
    hue = hue_basic(img).astype(np.float32)

    accept = np.zeros((H, W), dtype=bool)

    # 1. Reject specular metal: sat<0.12 && lum>=225
    reject_spec = (sat < 0.12) & (lum >= 225)

    # 2. Reject UV ambient on dark metal: hue 220-280, sat 0.15-0.32, lum 60-150 (sauf si sat>=0.40)
    reject_amb = ((hue >= 220) & (hue <= 280) &
                  (sat >= 0.15) & (sat <= 0.32) &
                  (lum >= 60) & (lum <= 150) &
                  (sat < 0.40))

    # 3. Override fluo absolu: sat>=0.40 && lum>=100 && in fluo band
    fluo_band = ((hue >= 165) & (hue <= 330)) | \
                ((hue >= 45)  & (hue <= 165)) | \
                ((hue >= 0)   & (hue <= 45))  | \
                ((hue >= 320) & (hue <= 360))
    accept_abs = (sat >= 0.40) & (lum >= 100) & fluo_band

    # 4. Voie diffuse contextuelle au fond: sat>=0.20 && lum>=bg.lum+20 && (sat-bg.sat)>=0.08
    clean_band = ((hue >= 170) & (hue <= 215)) | \
                 ((hue >= 60)  & (hue <= 160)) | \
                 ((hue >= 0)   & (hue <= 30))  | \
                 ((hue >= 320) & (hue <= 360))
    accept_diff = clean_band & (sat >= 0.20) & (lum >= bg_lum + 20) & ((sat - bg_sat) >= 0.08)
    # Anti-ambient
    anti_amb = (hue_distance(hue, bg_hue) < 12) & ((sat - bg_sat) < 0.12)
    accept_diff = accept_diff & ~anti_amb

    # 5. Voie standard: lum > bg.lum + lumDelta
    coloured = (sat >= cfg['minSaturation']) & ((sat - bg_sat) >= cfg['saturationDelta'])
    white = (sat <= cfg['whiteMaxSat']) & (lum >= cfg['whiteLuminance']) & (lum >= bg_lum + 70)
    accept_std = (lum >= bg_lum + cfg['luminanceDelta']) & (coloured | white)
    # Anti-voile
    anti_voile = coloured & (hue_distance(hue, bg_hue) < 8) & ((sat - bg_sat) < 0.20)
    accept_std = accept_std & ~anti_voile

    # Application en cascade (priorité au override absolu)
    accept = accept_abs | accept_diff | accept_std
    accept = accept & ~reject_spec & ~reject_amb

    return accept


# ─── Métriques de comparaison ──────────────────────────────────────────
def compare(mask_user, mask_detected):
    """Calcule precision, recall, IoU pixel-par-pixel."""
    user_bool = mask_user > 30  # alpha > 30 dans le mask peint
    det_bool  = mask_detected
    tp = np.sum(user_bool & det_bool)
    fp = np.sum(~user_bool & det_bool)
    fn = np.sum(user_bool & ~det_bool)
    tn = np.sum(~user_bool & ~det_bool)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall    = tp / (tp + fn) if (tp + fn) > 0 else 0
    iou       = tp / (tp + fp + fn) if (tp + fp + fn) > 0 else 0
    f1        = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    coverage_user = np.sum(user_bool) / user_bool.size * 100
    coverage_det  = np.sum(det_bool) / det_bool.size * 100
    return {
        'tp': int(tp), 'fp': int(fp), 'fn': int(fn), 'tn': int(tn),
        'precision': round(precision, 4),
        'recall': round(recall, 4),
        'iou': round(iou, 4),
        'f1': round(f1, 4),
        'coverage_user_pct': round(float(coverage_user), 2),
        'coverage_detected_pct': round(float(coverage_det), 2),
    }


# ─── Visualisation : crée une image de comparaison ─────────────────────
def make_compare_image(photo, mask_user, mask_detected, out_path):
    """Génère une image RGB :
       - vert : True positive (peint ET détecté)
       - rouge : False negative (peint mais raté)
       - bleu : False positive (détecté mais pas peint)
       - photo grisée en fond"""
    user_bool = mask_user > 30
    det_bool  = mask_detected
    tp = user_bool & det_bool
    fp = ~user_bool & det_bool
    fn = user_bool & ~det_bool
    out = (photo.astype(np.float32) * 0.4).astype(np.uint8)  # photo dim 40%
    out[tp] = [40, 220, 100]   # vert TP
    out[fp] = [80, 130, 255]   # bleu FP
    out[fn] = [255, 60, 80]    # rouge FN
    Image.fromarray(out).save(out_path)


# ─── Main ────────────────────────────────────────────────────────────
def main():
    photo = np.array(Image.open(os.path.join(WORKDIR, 'calibration_workdir', 'photo.jpg')).convert('RGB'))
    mask_user = np.array(Image.open(os.path.join(WORKDIR, 'calibration_workdir', 'mask.png')).convert('RGBA'))[..., 3]
    H, W = photo.shape[:2]
    print(f'Photo: {W}x{H}, Mask user alpha: {mask_user.shape}')

    # Build local background
    bg = build_local_background(photo)

    # Config par défaut (réplique JS CFG)
    cfg_default = {
        'minSaturation': 0.18,
        'saturationDelta': 0.08,
        'luminanceDelta': 30,
        'whiteMaxSat': 0.18,
        'whiteLuminance': 200,
    }

    detected = detect_fluorescent_pixels(photo, bg, cfg_default)
    metrics = compare(mask_user, detected)

    print('\n=== CONFIG ACTUELLE (reproduction JS) ===')
    for k, v in cfg_default.items():
        print(f'  {k}: {v}')
    print('\n=== METRIQUES (vs annotation utilisateur) ===')
    for k, v in metrics.items():
        print(f'  {k}: {v}')

    print('\n=== INTERPRETATION ===')
    print(f'  Precision (% des detections qui sont vraies) : {metrics["precision"]*100:.1f}%')
    print(f'  Recall    (% des vraies zones detectees)     : {metrics["recall"]*100:.1f}%')
    print(f'  IoU       (overlap precis)                    : {metrics["iou"]*100:.1f}%')
    print(f'  Couverture user      : {metrics["coverage_user_pct"]}%')
    print(f'  Couverture detection : {metrics["coverage_detected_pct"]}%')

    # Image de comparaison
    out_path = os.path.join(WORKDIR, 'calibration_workdir', 'compare_default.png')
    make_compare_image(photo, mask_user, detected, out_path)
    print(f'\n  -> Image comparee: {out_path}')
    print('     vert = TP (correct), rouge = FN (rate), bleu = FP (faux positif)')


if __name__ == '__main__':
    main()

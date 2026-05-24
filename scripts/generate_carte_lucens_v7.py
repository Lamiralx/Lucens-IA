"""
Carte de calibration Lucens V7 — HEIGHTMAP DENSE.

Refonte V33 (2026-05-24) — toutes les zones de texture ENTIÈREMENT
remplies par une grille fine de cellules à hauteur variable. Plus de
petits points épars : chaque patch est 100% texturé, avec variations
organiques de relief simulant les vrais résidus.

Approche : heightmap pixel
  - Patch divisé en grille fine (cell ~0.6 mm)
  - Chaque cellule a une HAUTEUR calculée par la fonction texture
  - Cellules au-dessus du seuil (0.10 mm) → cube de relief variable
  - Résultat : patch entièrement couvert, relief organique 3D
"""
from pathlib import Path
import qrcode
import trimesh
import numpy as np
import json


CARD_W = 75.0
CARD_H = 50.0
CARD_THICKNESS = 2.0
PLATEAU_HEIGHT = 0.4          # plateau fluo de base
TEX_MIN = 0.15                # relief minimum (cellules "plates")
TEX_MAX = 0.55                # relief maximum (sommets)
CELL = 0.6                    # taille cellule grille texture (mm)

SERIAL = 'LCNK7M2X'
QR_TEXT = f'LUCENS:CALIBV4:{SERIAL}'

# Layout V6 confirmé
QR_SIZE = 12.0
QR_CX = CARD_W / 2.0
QR_CY = 8.0

ARUCO_SIZE = 5.5
ARUCO_MARGIN = 2.0

LOGO_TEXT = 'LUCENS IA'
LOGO_FONT_SIZE = 3.0
LOGO_CHAR_W = 3.2
LOGO_CHAR_GAP = 1.0
LOGO_Y_FROM_BOTTOM = 3.5

GRID_COLS = 3
GRID_ROWS = 3
GRID_START_X = 3.0
GRID_START_Y = 15.5
GRID_GAP = 1.2
GRID_W = CARD_W - 2 * GRID_START_X
GRID_BOTTOM_RESERVE = LOGO_Y_FROM_BOTTOM + LOGO_FONT_SIZE + 1.5
GRID_AVAILABLE_H = CARD_H - GRID_START_Y - GRID_BOTTOM_RESERVE
PATCH_W = (GRID_W - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS
PATCH_H = (GRID_AVAILABLE_H - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS

TEXTURE_NAMES = [
    'POUSSIERE', 'TACHE',     'COULEE',
    'EMPREINTE', 'FIBRES',    'CROUTE',
    'CRATERES',  'VEINES',    'GRAIN',
]


def box_at(x, y, z, w, h, d):
    m = trimesh.creation.box(extents=[w, h, d])
    m.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return m


def y_top(y_top_val, h):
    return CARD_H - y_top_val - h


# ─── QR / ArUco / Logo (identiques à V6) ────────────────────────────
def generate_qr_matrix(text):
    qr = qrcode.QRCode(
        version=None, error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1, border=0,
    )
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()


def build_qr_zone():
    parts = []
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    module = QR_SIZE / n
    ox = QR_CX - QR_SIZE / 2
    oy = CARD_H - (QR_CY - QR_SIZE / 2) - QR_SIZE
    parts.append(box_at(ox - 0.7, oy - 0.7, CARD_THICKNESS, QR_SIZE + 1.4, QR_SIZE + 1.4, PLATEAU_HEIGHT))
    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                mx = ox + col * module
                my = oy + (n - 1 - row) * module
                parts.append(box_at(mx, my, CARD_THICKNESS + PLATEAU_HEIGHT, module, module, 0.30))
    return parts


ARUCO_PATTERNS = {
    0: [[1,0,1,1],[0,1,0,0],[1,1,1,0],[0,0,1,1]],
    1: [[1,1,0,1],[0,0,1,1],[1,0,0,0],[1,1,1,0]],
    2: [[0,1,1,0],[1,0,1,1],[1,1,0,0],[0,1,0,1]],
    3: [[1,1,1,1],[0,0,0,1],[1,0,1,0],[1,1,0,1]],
}


def build_aruco(cx, cyt, mid):
    parts = []
    pat = ARUCO_PATTERNS[mid]
    cell = ARUCO_SIZE / 6
    ys = y_top(cyt, ARUCO_SIZE)
    parts.append(box_at(cx, ys, CARD_THICKNESS, ARUCO_SIZE, ARUCO_SIZE, PLATEAU_HEIGHT))
    for r in range(6):
        for c in range(6):
            is_b = (r == 0 or r == 5 or c == 0 or c == 5)
            if is_b or pat[r-1][c-1] == 1:
                mx = cx + c * cell
                my = ys + (5 - r) * cell
                parts.append(box_at(mx, my, CARD_THICKNESS + PLATEAU_HEIGHT, cell, cell, 0.30))
    return parts


def build_all_arucos_split():
    fl, bk = [], []
    for mid, (cx, cy) in enumerate([
        (ARUCO_MARGIN, ARUCO_MARGIN),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, ARUCO_MARGIN),
        (ARUCO_MARGIN, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
    ]):
        p = build_aruco(cx, cy, mid)
        fl.append(p[0])
        bk.extend(p[1:])
    return fl, bk


GLYPHS_5x7 = {
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'S': ['01110','10001','10000','01110','00001','10001','01110'],
    'I': ['11111','00100','00100','00100','00100','00100','11111'],
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
}


def build_logo():
    parts = []
    pw = LOGO_CHAR_W / 5.0
    ph = LOGO_FONT_SIZE / 7.0
    total_w = len(LOGO_TEXT) * LOGO_CHAR_W + (len(LOGO_TEXT) - 1) * LOGO_CHAR_GAP
    xc = (CARD_W - total_w) / 2
    ys = LOGO_Y_FROM_BOTTOM
    for ch in LOGO_TEXT:
        g = GLYPHS_5x7.get(ch, GLYPHS_5x7[' '])
        for ri, row in enumerate(g):
            for ci, p in enumerate(row):
                if p == '1':
                    parts.append(box_at(xc + ci*pw, ys + (6-ri)*ph, CARD_THICKNESS,
                                        pw*1.06, ph*1.06, PLATEAU_HEIGHT))
        xc += LOGO_CHAR_W + LOGO_CHAR_GAP
    return parts


# ─── HEIGHTMAP générateurs ────────────────────────────────────────────
def patch_grid_dims():
    nx = max(8, int(PATCH_W / CELL))
    ny = max(4, int(PATCH_H / CELL))
    cw = PATCH_W / nx
    ch = PATCH_H / ny
    return nx, ny, cw, ch


def heightmap_to_boxes(heights, x, y):
    """heights[ny][nx] de float en mm. Place 1 cube par cellule au-dessus
    du plateau pour chaque cellule où height > TEX_MIN."""
    parts = []
    ny = len(heights)
    nx = len(heights[0]) if ny else 0
    cw = PATCH_W / nx
    ch = PATCH_H / ny
    z0 = CARD_THICKNESS + PLATEAU_HEIGHT
    for ri in range(ny):
        for ci in range(nx):
            h = heights[ri][ci]
            if h < TEX_MIN: continue
            h = min(h, TEX_MAX)
            cx = x + ci * cw
            cy = y + (ny - 1 - ri) * ch  # ri=0 = haut visuellement
            parts.append(box_at(cx, cy, z0, cw, ch, h))
    return parts


def _rng(idx):
    return np.random.RandomState(2000 + idx * 31)


def tex_poussiere(rng):
    """Densité de poussière variable : centre dense, périphérie moins."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.5)  # fond très bas (couche d'accroche)
    cx, cy = nx / 2, ny / 2
    for ri in range(ny):
        for ci in range(nx):
            # Gaussienne centrée
            d = np.hypot((ci - cx) / cx, (ri - cy) / cy)
            density = np.exp(-d * d * 1.4)
            if rng.random() < (0.30 + 0.50 * density):
                H[ri, ci] = TEX_MIN + 0.05 + rng.random() * (0.30 + 0.20 * density)
    return H


def tex_tache(rng):
    """Tache liquide séché : corps dense + anneau d'évaporation."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.4)
    cx = nx * (0.4 + rng.random() * 0.2)
    cy = ny * (0.4 + rng.random() * 0.2)
    r_body = min(nx, ny) * 0.30
    r_ring = r_body * 1.6
    for ri in range(ny):
        for ci in range(nx):
            d = np.hypot(ci - cx, ri - cy)
            if d < r_body * 0.7:
                H[ri, ci] = 0.35 + rng.random() * 0.20
            elif d < r_body:
                # bord du corps
                t = 1 - (d - r_body * 0.7) / (r_body * 0.3)
                H[ri, ci] = 0.20 + 0.15 * t + rng.random() * 0.10
            elif abs(d - r_ring) < 0.8:
                # anneau d'évaporation
                H[ri, ci] = 0.22 + rng.random() * 0.18
            elif rng.random() < 0.18:
                # gouttelettes éparses
                H[ri, ci] = TEX_MIN + 0.05 + rng.random() * 0.10
    return H


def tex_coulee(rng):
    """Coulées verticales : bandes hautes en descendant + traînées."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.5)
    n_streams = 2 + rng.randint(0, 2)
    for s in range(n_streams):
        cx = (s + 0.5) * nx / n_streams + rng.normal(0, 1.0)
        width = 1.5 + rng.random() * 1.5
        for ri in range(ny):
            # drift latéral progressif
            drift = rng.normal(0, 0.3)
            cx_cur = cx + drift
            t = ri / ny
            for ci in range(nx):
                d = abs(ci - cx_cur)
                if d < width * (1 + t * 0.4):
                    h = 0.35 + (1 - t) * 0.15 + rng.normal(0, 0.05)
                    if d > width * 0.6:
                        h *= 0.6
                    if h > H[ri, ci]:
                        H[ri, ci] = max(TEX_MIN, h)
    # Gouttelettes éparses dans le reste
    for ri in range(ny):
        for ci in range(nx):
            if H[ri, ci] < TEX_MIN and rng.random() < 0.12:
                H[ri, ci] = TEX_MIN + 0.04 + rng.random() * 0.10
    return H


def tex_empreinte(rng):
    """Empreinte digitale : ellipses concentriques perturbées."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.6)
    cx, cy = nx / 2, ny / 2
    n_loops = 6
    for ri in range(ny):
        for ci in range(nx):
            # Coordonnées normalisées au centre
            dx = (ci - cx) / cx
            dy = (ri - cy) / cy
            r = np.hypot(dx, dy * 0.85)
            # Distance au loop le plus proche
            loop_idx = r * n_loops
            frac = abs(loop_idx - round(loop_idx))
            # Perturbation organique
            wobble = 0.1 * np.sin(ci * 0.7 + ri * 0.5)
            ridge = max(0, 0.25 - abs(frac - 0.1) * 2 + wobble)
            H[ri, ci] = max(TEX_MIN * 0.8, TEX_MIN + ridge + rng.normal(0, 0.04))
    return H


def tex_fibres(rng):
    """Fibres textiles : entrelaçage lignes directionnelles."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.6)
    n_fibres = 18
    for _ in range(n_fibres):
        sx = rng.random() * nx
        sy = rng.random() * ny
        ang = rng.random() * 2 * np.pi
        length = 6 + rng.random() * 12
        for s in range(int(length)):
            t = s
            x_pos = sx + np.cos(ang) * t + rng.normal(0, 0.3)
            y_pos = sy + np.sin(ang) * t + rng.normal(0, 0.3)
            xi, yi = int(round(x_pos)), int(round(y_pos))
            if 0 <= xi < nx and 0 <= yi < ny:
                H[yi, xi] = max(H[yi, xi], 0.30 + rng.random() * 0.15)
                # élargissement perpendiculaire
                for dx, dy in [(0,1), (0,-1), (1,0), (-1,0)]:
                    xi2, yi2 = xi+dx, yi+dy
                    if 0 <= xi2 < nx and 0 <= yi2 < ny:
                        H[yi2, xi2] = max(H[yi2, xi2], 0.20 + rng.random() * 0.10)
    return H


def tex_croute(rng):
    """Croûte écaillée : plaques irrégulières superposées en niveaux."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN + 0.05)
    n_plates = 12
    for _ in range(n_plates):
        pw = rng.randint(3, 7)
        ph = rng.randint(2, 5)
        px = rng.randint(0, max(1, nx - pw))
        py = rng.randint(0, max(1, ny - ph))
        plate_h = 0.25 + rng.random() * 0.25
        for r in range(py, py + ph):
            for c in range(px, px + pw):
                if r < ny and c < nx:
                    if H[r, c] < plate_h:
                        H[r, c] = plate_h + rng.normal(0, 0.03)
    # Ajout micro-grain partout
    for ri in range(ny):
        for ci in range(nx):
            H[ri, ci] += rng.normal(0, 0.025)
            H[ri, ci] = max(TEX_MIN, H[ri, ci])
    return H


def tex_crateres(rng):
    """Cratères : anneaux concaves (anneau haut, intérieur bas)."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), 0.20 + 0.05 * rng.random())
    n_craters = 7
    centers = []
    for _ in range(n_craters):
        cx = rng.randint(2, max(3, nx - 2))
        cy = rng.randint(2, max(3, ny - 2))
        r_outer = 1.5 + rng.random() * 1.5
        centers.append((cx, cy, r_outer))
    for ri in range(ny):
        for ci in range(nx):
            for (cx, cy, r) in centers:
                d = np.hypot(ci - cx, ri - cy)
                if abs(d - r) < 0.7:
                    H[ri, ci] = max(H[ri, ci], 0.35 + rng.random() * 0.15)
                elif d < r - 0.3:
                    # creux intérieur
                    H[ri, ci] = min(H[ri, ci], TEX_MIN + 0.03)
    return H


def tex_veines(rng):
    """Réseau de veines ramifiées (biofilm)."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.full((ny, nx), TEX_MIN * 0.6)
    # Tracer 4 branches depuis le centre
    cx, cy = nx / 2 + rng.normal(0, 1), ny / 2 + rng.normal(0, 1)
    n_branches = 4
    for b in range(n_branches):
        ang = b * 2 * np.pi / n_branches + rng.normal(0, 0.4)
        x_pos, y_pos = cx, cy
        for s in range(20):
            ang += rng.normal(0, 0.3)
            x_pos += np.cos(ang) * 0.9
            y_pos += np.sin(ang) * 0.9
            xi, yi = int(round(x_pos)), int(round(y_pos))
            if 0 <= xi < nx and 0 <= yi < ny:
                H[yi, xi] = max(H[yi, xi], 0.32 + rng.random() * 0.15)
                for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)]:
                    xi2, yi2 = xi+dx, yi+dy
                    if 0 <= xi2 < nx and 0 <= yi2 < ny:
                        H[yi2, xi2] = max(H[yi2, xi2], 0.22 + rng.random() * 0.10)
            # branche secondaire occasionnelle
            if s > 4 and rng.random() < 0.18:
                sub_ang = ang + rng.choice([-1, 1]) * np.pi/3
                sx, sy = x_pos, y_pos
                for ss in range(6):
                    sx += np.cos(sub_ang) * 0.8
                    sy += np.sin(sub_ang) * 0.8
                    xi, yi = int(round(sx)), int(round(sy))
                    if 0 <= xi < nx and 0 <= yi < ny:
                        H[yi, xi] = max(H[yi, xi], 0.25 + rng.random() * 0.10)
    # Micro-relief partout pour densité
    for ri in range(ny):
        for ci in range(nx):
            if H[ri, ci] < TEX_MIN:
                H[ri, ci] = TEX_MIN + rng.normal(0, 0.02)
    return H


def tex_grain(rng):
    """Grain dégradé : densité décroissante du haut vers le bas."""
    nx, ny, _, _ = patch_grid_dims()
    H = np.zeros((ny, nx))
    for ri in range(ny):
        for ci in range(nx):
            # densité forte en haut, faible en bas
            density = 1 - (ri / ny)
            base = TEX_MIN + density * 0.20
            jitter = rng.normal(0, 0.10) * density
            H[ri, ci] = max(TEX_MIN, base + jitter + rng.random() * 0.15 * density)
    return H


TEXTURE_BUILDERS = {
    'POUSSIERE': tex_poussiere, 'TACHE': tex_tache, 'COULEE': tex_coulee,
    'EMPREINTE': tex_empreinte, 'FIBRES': tex_fibres, 'CROUTE': tex_croute,
    'CRATERES': tex_crateres, 'VEINES': tex_veines, 'GRAIN': tex_grain,
}


def build_patch_full(col, row, name, idx):
    x = GRID_START_X + col * (PATCH_W + GRID_GAP)
    y_top_val = GRID_START_Y + row * (PATCH_H + GRID_GAP)
    y_stl = y_top(y_top_val, PATCH_H)
    plateau = box_at(x, y_stl, CARD_THICKNESS, PATCH_W, PATCH_H, PLATEAU_HEIGHT)
    rng = _rng(idx)
    heights = TEXTURE_BUILDERS[name](rng)
    reliefs = heightmap_to_boxes(heights, x, y_stl)
    return plateau, reliefs


def build_card_mesh():
    print(f'V7 — Carte Lucens HEIGHTMAP DENSE, serial: {SERIAL}')
    base = box_at(0, 0, 0, CARD_W, CARD_H, CARD_THICKNESS)
    all_fluo, all_black = [], []

    total_relief = 0
    for idx, name in enumerate(TEXTURE_NAMES):
        col = idx % GRID_COLS
        row = idx // GRID_COLS
        plateau, reliefs = build_patch_full(col, row, name, idx)
        all_fluo.append(plateau)
        all_fluo.extend(reliefs)
        total_relief += len(reliefs)
    print(f'  9 plateaux fluo + {total_relief} cellules de heightmap dense')

    all_fluo.extend(build_logo())
    print(f'  Logo LUCENS IA en BAS')

    qr = build_qr_zone()
    all_fluo.append(qr[0])
    all_black.extend(qr[1:])
    af, ab = build_all_arucos_split()
    all_fluo.extend(af)
    all_black.extend(ab)
    print(f'  QR haut-centre + 4 ArUco coins')

    print('  Concat final (union manifold optionnelle si trimesh.boolean OK)...')
    all_meshes = [base] + all_fluo + all_black
    card = trimesh.util.concatenate(all_meshes)
    try:
        union = trimesh.boolean.union(all_meshes, engine='manifold')
        if union is not None and len(union.faces) > 0:
            card = union
            print(f'  Union manifold OK : {len(card.faces)} triangles')
    except Exception as e:
        print(f'  Union manifold échec ({e}), fallback concat ({len(card.faces)} tri)')
    return card


def main():
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    root = Path(__file__).resolve().parent.parent
    out_dir = root / 'docs' / 'carte-lucens-3d'
    stl_path = out_dir / 'carte-lucens-v7.stl'
    stl_root = root / 'carte-lucens-v7.stl'

    print('-' * 60)
    card = build_card_mesh()
    print(f'  Mesh final : {len(card.faces)} triangles, vol={card.volume / 1000:.1f} cm3')
    card.export(stl_path)
    card.export(stl_root)
    print(f'  OK STL -> {stl_path}')
    print(f'  OK STL (racine) -> {stl_root}')

    manifest = {
        'product': 'Lucens IA Calibration Card V7 (heightmap dense)',
        'serial': SERIAL, 'qr_payload': QR_TEXT,
        'dimensions_mm': {'w': CARD_W, 'h': CARD_H, 't': CARD_THICKNESS},
        'plateau_height_mm': PLATEAU_HEIGHT,
        'texture_relief_range_mm': [TEX_MIN, TEX_MAX],
        'cell_size_mm': CELL,
        'patches': {'count': 9, 'layout': '3x3', 'textures': TEXTURE_NAMES},
        'approach': 'Chaque patch ENTIÈREMENT rempli par grille de cellules de hauteur variable (heightmap pixel). Pas de petits points épars.',
    }
    mp = out_dir / f'carte-lucens-v7-{SERIAL}.json'
    mp.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'  OK Manifest -> {mp}')
    print('-' * 60)


if __name__ == '__main__':
    main()

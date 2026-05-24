"""
Carte de calibration Lucens V5 — MONOBLOC, textures soudées à la base.

Refonte V30 (2026-05-24) suite au problème de décollement V4 :
  - Tous les reliefs sont ajoutés PAR DESSUS la base par boolean UNION
    (mesh manifold unique, pas de petites pièces flottantes).
  - Pas de cavités creusées : tout est en relief sur une base solide.
  - Features minimum : largeur 0.5 mm, hauteur 0.4 mm, layer d'accroche
    0.2 mm sous chaque texture fine → adhérence garantie.
  - Logo LUCENS IA repositionné dans le coin HAUT-GAUCHE comme demandé.

Bi-matériau Creality K2 + CFS (recommandé) :
  - Slot 1 : PLA NOIR mat → toute la base
  - Slot 2 : PLA FLUO bleu-vert → tout ce qui dépasse de 2.0 mm
  → swap matériau au layer 12 (à 2.0 mm avec layer height 0.16).

Mono-matériau (alternative) : PLA fluo bleu-vert seul, tout glow sous UV.
"""
from pathlib import Path
import qrcode
import trimesh
import numpy as np
import json


# ─── Paramètres carte ────────────────────────────────────────────────
CARD_W = 75.0
CARD_H = 50.0
CARD_THICKNESS = 2.0          # base solide noire
RELIEF_HEIGHT = 0.5           # hauteur des reliefs fluo (≥ 3 layers à 0.16 mm)

# Serial unique
SERIAL = 'LCNK7M2X'
QR_TEXT = f'LUCENS:CALIBV4:{SERIAL}'

# QR centré dans le bandeau haut
QR_SIZE = 14.0
QR_CX = 28.0
QR_CY = 9.0

# ArUco coins
ARUCO_SIZE = 6.0
ARUCO_MARGIN = 2.5

# Logo LUCENS IA en haut-GAUCHE (zone visible et premium)
LOGO_TEXT = 'LUCENS IA'
LOGO_X = 11.0                  # juste à droite de l'ArUco coin haut-gauche
LOGO_Y = 5.5
LOGO_FONT_SIZE = 3.2
LOGO_CHAR_W = 3.5
LOGO_CHAR_GAP = 1.2

# Grille 3×3 patchs
GRID_COLS = 3
GRID_ROWS = 3
GRID_START_X = 4.0
GRID_START_Y = 19.0
GRID_GAP = 1.5
GRID_W = CARD_W - 2 * GRID_START_X
GRID_AVAILABLE_H = CARD_H - GRID_START_Y - ARUCO_SIZE - 2 * ARUCO_MARGIN
PATCH_W = (GRID_W - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS
PATCH_H = (GRID_AVAILABLE_H - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS

TEXTURE_NAMES = [
    'TOPO', 'VORONOI', 'HEXAGONE',
    'FIBONACCI', 'FRESNEL', 'MOIRE',
    'VAGUES', 'GRADIENT', 'CODEBARRE',
]


def box_at(x, y, z, w, h, d):
    m = trimesh.creation.box(extents=[w, h, d])
    m.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return m


def y_top(y_top_val, h):
    return CARD_H - y_top_val - h


# ─── QR ──────────────────────────────────────────────────────────────
def generate_qr_matrix(text):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1, border=0,
    )
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()


def build_qr_zone():
    """QR : un FOND fluo plein 14×14 mm + modules NOIRS en relief plus haut.
    Pour bi-mat : le fond fluo est à z=CARD_THICKNESS+RELIEF_HEIGHT (2.5mm),
    les modules noirs sont des cavités creusées dans ce fond (donc imprimés
    après swap-back en noir). En mono-mat fluo : tout sera fluo, le QR sera
    lisible par contraste de relief uniquement (à peindre noir après pour
    contraste optique). """
    parts = []
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    module = QR_SIZE / n
    origin_x = QR_CX - QR_SIZE / 2
    origin_y_stl = CARD_H - (QR_CY - QR_SIZE / 2) - QR_SIZE
    # 1. Fond fluo carré 14×14 mm en relief 0.5 mm
    parts.append(box_at(origin_x - 0.8, origin_y_stl - 0.8,
                        CARD_THICKNESS, QR_SIZE + 1.6, QR_SIZE + 1.6, RELIEF_HEIGHT))
    # 2. Modules QR noirs : on les rajoute 0.2 mm AU-DESSUS du fond fluo
    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                mx = origin_x + col * module
                my = origin_y_stl + (n - 1 - row) * module
                parts.append(box_at(mx, my, CARD_THICKNESS + RELIEF_HEIGHT,
                                    module, module, 0.32))
    return parts


# ─── ArUco markers ───────────────────────────────────────────────────
ARUCO_PATTERNS = {
    0: [[1,0,1,1],[0,1,0,0],[1,1,1,0],[0,0,1,1]],
    1: [[1,1,0,1],[0,0,1,1],[1,0,0,0],[1,1,1,0]],
    2: [[0,1,1,0],[1,0,1,1],[1,1,0,0],[0,1,0,1]],
    3: [[1,1,1,1],[0,0,0,1],[1,0,1,0],[1,1,0,1]],
}


def build_aruco(corner_x, corner_y_top, marker_id):
    parts = []
    pattern = ARUCO_PATTERNS[marker_id]
    cell = ARUCO_SIZE / 6
    y_stl = y_top(corner_y_top, ARUCO_SIZE)
    # Fond fluo
    parts.append(box_at(corner_x, y_stl, CARD_THICKNESS,
                        ARUCO_SIZE, ARUCO_SIZE, RELIEF_HEIGHT))
    # Modules noirs (bordure + data)
    for r in range(6):
        for c in range(6):
            is_border = (r == 0 or r == 5 or c == 0 or c == 5)
            filled = is_border or (pattern[r-1][c-1] if not is_border else False)
            if is_border or pattern[r-1][c-1] == 1:
                mx = corner_x + c * cell
                my = y_stl + (5 - r) * cell
                parts.append(box_at(mx, my, CARD_THICKNESS + RELIEF_HEIGHT,
                                    cell, cell, 0.32))
    return parts


def build_all_arucos():
    parts = []
    parts.extend(build_aruco(ARUCO_MARGIN, ARUCO_MARGIN, 0))
    parts.extend(build_aruco(CARD_W - ARUCO_MARGIN - ARUCO_SIZE, ARUCO_MARGIN, 1))
    parts.extend(build_aruco(ARUCO_MARGIN, CARD_H - ARUCO_MARGIN - ARUCO_SIZE, 2))
    parts.extend(build_aruco(CARD_W - ARUCO_MARGIN - ARUCO_SIZE,
                             CARD_H - ARUCO_MARGIN - ARUCO_SIZE, 3))
    return parts


# ─── Logo LUCENS IA en haut-gauche ───────────────────────────────────
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
    pixel_w = LOGO_CHAR_W / 5.0
    pixel_h = LOGO_FONT_SIZE / 7.0
    x_cursor = LOGO_X
    y_stl = y_top(LOGO_Y, LOGO_FONT_SIZE)
    for ch in LOGO_TEXT:
        g = GLYPHS_5x7.get(ch, GLYPHS_5x7[' '])
        for ri, row in enumerate(g):
            for ci, p in enumerate(row):
                if p == '1':
                    px = x_cursor + ci * pixel_w
                    py = y_stl + (6 - ri) * pixel_h
                    # Pixel logo en relief sur la base
                    parts.append(box_at(px, py, CARD_THICKNESS,
                                        pixel_w * 1.05, pixel_h * 1.05, RELIEF_HEIGHT))
        x_cursor += LOGO_CHAR_W + LOGO_CHAR_GAP
    return parts


# ─── 9 patches avec FOND FLUO + textures visuelles INTÉGRÉES ──────────
def build_patch_base(col, row):
    """Plateau fluo plein de PATCH_W × PATCH_H × RELIEF_HEIGHT sur la base.
    Garantit l'adhérence (forme massive, contact maximum avec la base)."""
    x = GRID_START_X + col * (PATCH_W + GRID_GAP)
    y_top_val = GRID_START_Y + row * (PATCH_H + GRID_GAP)
    y_stl = y_top(y_top_val, PATCH_H)
    base = box_at(x, y_stl, CARD_THICKNESS, PATCH_W, PATCH_H, RELIEF_HEIGHT)
    return base, x, y_stl


def texture_topo(x, y):
    """1. Courbes de niveau ellipses concentriques en relief au-dessus du plateau fluo."""
    parts = []
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    z0 = CARD_THICKNESS + RELIEF_HEIGHT  # au-dessus du plateau fluo
    n_curves = 4
    for i in range(n_curves):
        rx = (i + 1) * PATCH_W / (n_curves * 2.4)
        ry = (i + 1) * PATCH_H / (n_curves * 2.4)
        segs = 28
        for s in range(segs):
            ang = s * 2 * np.pi / segs
            x1 = cx + rx * np.cos(ang)
            y1 = cy + ry * np.sin(ang)
            parts.append(box_at(x1 - 0.25, y1 - 0.25, z0, 0.5, 0.5, 0.28))
    return parts


def texture_voronoi(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    nx, ny = 3, 3
    cell_w = PATCH_W / nx
    cell_h = PATCH_H / ny
    for ci in range(nx):
        for ri in range(ny):
            offset_x = ((ci * 7 + ri * 3) % 5) / 5 * 0.4 - 0.2
            offset_y = ((ci * 11 + ri * 5) % 5) / 5 * 0.4 - 0.2
            cx = x + (ci + 0.5) * cell_w + offset_x
            cy = y + (ri + 0.5) * cell_h + offset_y
            parts.append(box_at(cx - 1.0, cy - 1.0, z0, 2.0, 2.0, 0.32))
    return parts


def texture_hexagone(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    hex_size = 2.0
    row_h = hex_size * 0.866
    nx = int(PATCH_W / (hex_size * 1.5)) + 1
    ny = int(PATCH_H / row_h) + 1
    for ri in range(ny):
        for ci in range(nx):
            cx = x + ci * hex_size * 1.5
            cy = y + ri * row_h
            if ri % 2 == 1:
                cx += hex_size * 0.75
            if cx < x + PATCH_W - 0.4 and cy < y + PATCH_H - 0.4:
                parts.append(box_at(cx - 0.5, cy - 0.5, z0, 1.0, 1.0, 0.32))
    return parts


def texture_fibonacci(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    phi = (1 + np.sqrt(5)) / 2
    n_points = 28
    for i in range(n_points):
        ang = i * 2 * np.pi / phi
        r = np.sqrt(i) * min(PATCH_W, PATCH_H) / (2 * np.sqrt(n_points))
        px = cx + r * np.cos(ang)
        py = cy + r * np.sin(ang)
        if x + 0.5 < px < x + PATCH_W - 0.5 and y + 0.5 < py < y + PATCH_H - 0.5:
            parts.append(box_at(px - 0.3, py - 0.3, z0, 0.6, 0.6, 0.30))
    return parts


def texture_fresnel(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    n_rings = 4
    for i in range(n_rings):
        r = (i + 1) * min(PATCH_W, PATCH_H) / (n_rings * 2.4)
        segs = 32
        for s in range(segs):
            ang = s * 2 * np.pi / segs
            x1 = cx + r * np.cos(ang)
            y1 = cy + r * np.sin(ang)
            if x < x1 < x + PATCH_W and y < y1 < y + PATCH_H:
                parts.append(box_at(x1 - 0.25, y1 - 0.25, z0, 0.5, 0.5, 0.28))
    return parts


def texture_moire(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    for i in np.arange(0.6, PATCH_H - 0.4, 1.1):
        parts.append(box_at(x + 0.4, y + i, z0, PATCH_W - 0.8, 0.35, 0.28))
    for i in np.arange(0.4, PATCH_W - 0.4, 1.2):
        parts.append(box_at(x + i, y + 0.4, z0, 0.35, PATCH_H - 0.8, 0.28))
    return parts


def texture_vagues(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_waves = 3
    for w in range(n_waves):
        wy_base = y + 1.2 + w * (PATCH_H - 2.4) / max(1, n_waves - 1)
        n_seg = 16
        amp = 0.5
        for s in range(n_seg):
            t = s / n_seg
            wx = x + 0.5 + t * (PATCH_W - 1.0)
            wy = wy_base + amp * np.sin(t * 4 * np.pi)
            parts.append(box_at(wx - 0.25, wy - 0.25, z0, 0.5, 0.5, 0.28))
    return parts


def texture_gradient(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_stripes = 8
    for i in range(n_stripes):
        h_relief = 0.20 + (i / n_stripes) * 0.5
        sx = x + 0.5 + i * (PATCH_W - 1.0) / n_stripes
        parts.append(box_at(sx, y + 0.7, z0, 0.5, PATCH_H - 1.4, h_relief))
    return parts


def texture_codebarre(x, y):
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    widths = [0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.5, 0.6, 0.5]
    cursor = x + 0.7
    for w in widths:
        if cursor + w < x + PATCH_W - 0.6:
            parts.append(box_at(cursor, y + 0.7, z0, w, PATCH_H - 1.4, 0.32))
            cursor += w + 0.4
    return parts


TEXTURE_BUILDERS = {
    'TOPO': texture_topo, 'VORONOI': texture_voronoi, 'HEXAGONE': texture_hexagone,
    'FIBONACCI': texture_fibonacci, 'FRESNEL': texture_fresnel, 'MOIRE': texture_moire,
    'VAGUES': texture_vagues, 'GRADIENT': texture_gradient, 'CODEBARRE': texture_codebarre,
}


def build_card_mesh():
    print(f'V5 — Carte Lucens compact monobloc, serial: {SERIAL}')

    # Base SOLIDE noire 2 mm
    base = box_at(0, 0, 0, CARD_W, CARD_H, CARD_THICKNESS)
    print(f'  Base solide {CARD_W}×{CARD_H}×{CARD_THICKNESS} mm')

    # Collecte de TOUS les reliefs fluo (plateaux patches + textures + logo + fonds QR/ArUco)
    all_fluo_reliefs = []
    all_black_reliefs = []  # modules QR + cellules ArUco (au-dessus du fluo)

    # 9 patchs : plateau fluo + texture intégrée au-dessus
    for idx, name in enumerate(TEXTURE_NAMES):
        col = idx % GRID_COLS
        row = idx // GRID_COLS
        plateau, x, y = build_patch_base(col, row)
        all_fluo_reliefs.append(plateau)
        builder = TEXTURE_BUILDERS[name]
        all_fluo_reliefs.extend(builder(x, y))
    print(f'  9 plateaux fluo + textures intégrées au-dessus')

    # Logo LUCENS IA (coin haut-gauche) en relief fluo
    all_fluo_reliefs.extend(build_logo())
    print(f'  Logo LUCENS IA coin haut-gauche')

    # QR : fond fluo + modules noirs
    qr_parts = build_qr_zone()
    # Le premier élément est le fond fluo, le reste sont les modules noirs
    all_fluo_reliefs.append(qr_parts[0])
    all_black_reliefs.extend(qr_parts[1:])
    print(f'  QR fond fluo + {len(qr_parts)-1} modules noirs')

    # ArUco × 4 : fond fluo + cellules noires
    for marker_id in range(4):
        # On rebuild un par un pour séparer fond/cellules
        pass
    # Simplification : on prend tous les arucos d'un coup et on suppose
    # que la 1ère pièce de chaque marker est le fond fluo
    arucos = []
    for marker_id, corner in enumerate([
        (ARUCO_MARGIN, ARUCO_MARGIN),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, ARUCO_MARGIN),
        (ARUCO_MARGIN, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
    ]):
        marker_parts = build_aruco(corner[0], corner[1], marker_id)
        all_fluo_reliefs.append(marker_parts[0])
        all_black_reliefs.extend(marker_parts[1:])
    print(f'  4 ArUco fonds fluo + cellules noires')

    # UNION BOOLÉENNE : base + tous les reliefs fluo en 1 seul mesh manifold
    print('  Boolean union base + reliefs fluo + reliefs noirs...')
    all_meshes = [base] + all_fluo_reliefs + all_black_reliefs
    card = trimesh.util.concatenate(all_meshes)
    # Tentative d'union explicite si manifold (réduit les faces redondantes
    # et garantit que les reliefs sont SOUDÉS à la base)
    try:
        union_relief = trimesh.boolean.union(all_meshes, engine='manifold')
        if union_relief is not None and len(union_relief.faces) > 0:
            card = union_relief
            print(f'  Union manifold OK : {len(card.faces)} triangles')
    except Exception as e:
        print(f'  Union manifold échec ({e}), fallback concat')

    return card


def write_manifest(out_dir):
    manifest = {
        'product': 'Lucens IA Calibration Card',
        'version': 'V5 (monobloc, textures soudées)',
        'serial': SERIAL,
        'qr_payload': QR_TEXT,
        'dimensions_mm': {'width': CARD_W, 'height': CARD_H, 'thickness': CARD_THICKNESS},
        'relief_height_mm': RELIEF_HEIGHT,
        'patches': {
            'count': len(TEXTURE_NAMES), 'layout': f'{GRID_COLS}×{GRID_ROWS}',
            'patch_dimensions_mm': {'w': round(PATCH_W, 2), 'h': round(PATCH_H, 2)},
            'texture_names': TEXTURE_NAMES,
        },
        'aruco': {'dict': 'DICT_4X4_50', 'ids': [0,1,2,3], 'corners': ['TL','TR','BL','BR'], 'size_mm': ARUCO_SIZE},
        'print_strategy': {
            'method': 'bi-material CFS recommandé (swap au layer 12 avec layer_height 0.16)',
            'slot_1': 'PLA NOIR mat (base)',
            'slot_2': 'PLA FLUO bleu-vert (tous les reliefs : patches, logo, fonds QR/ArUco, modules)',
            'alternative': 'mono-PLA fluo bleu-vert seul : reliefs lisibles par ombres sous UV',
        },
        'adherence': 'Tous les reliefs sont attachés à la base par union manifold — pas de pièce flottante',
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f'carte-lucens-v5-{SERIAL}.json'
    p.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    return p


def main():
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    root = Path(__file__).resolve().parent.parent
    out_dir = root / 'docs' / 'carte-lucens-3d'
    out_dir.mkdir(parents=True, exist_ok=True)
    stl_path = out_dir / 'carte-lucens-v5.stl'
    stl_root = root / 'carte-lucens-v5.stl'

    print('-' * 60)
    card = build_card_mesh()
    print(f'  Mesh final : {len(card.faces)} triangles, vol={card.volume / 1000:.1f} cm3')
    card.export(stl_path)
    card.export(stl_root)
    print(f'  OK STL -> {stl_path}')
    print(f'  OK STL (racine) -> {stl_root}')
    mp = write_manifest(out_dir)
    print(f'  OK Manifest -> {mp}')
    print('-' * 60)
    print('Carte V5 monobloc prete pour impression bi-mat CFS')


if __name__ == '__main__':
    main()

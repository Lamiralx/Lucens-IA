"""
Carte de calibration Lucens V6 — TEXTURES ORGANIQUES RÉALISTES.

Refonte V32 (2026-05-24) :
  - 9 textures qui IMITENT VRAIMENT les résidus rencontrés terrain :
    poussière, taches liquide, coulées, empreintes, fibres, croûtes,
    cratères, veines, grain. Pas de patterns géométriques abstraits.
  - Basé sur génération pseudo-aléatoire reproductible (seed fixe)
    pour réalisme organique + impression identique entre cartes.
  - Plateaux fluo unifiés à la base par boolean union (adhérence parfaite).
  - Logo LUCENS IA repositionné EN BAS de la carte.
  - QR en HAUT-CENTRE comme demandé.

Bi-matériau Creality K2 + CFS :
  - Slot 1 : PLA NOIR mat (base + modules QR + cellules ArUco)
  - Slot 2 : PLA FLUO bleu-vert (plateaux patches + reliefs textures + logo + fonds QR/ArUco)
"""
from pathlib import Path
import qrcode
import trimesh
import numpy as np
import json


# ─── Paramètres carte ────────────────────────────────────────────────
CARD_W = 75.0
CARD_H = 50.0
CARD_THICKNESS = 2.0
RELIEF_HEIGHT = 0.5

SERIAL = 'LCNK7M2X'
QR_TEXT = f'LUCENS:CALIBV4:{SERIAL}'

# QR en HAUT-CENTRE
QR_SIZE = 12.0
QR_CX = CARD_W / 2.0
QR_CY = 8.0  # depuis HAUT

# ArUco aux 4 coins
ARUCO_SIZE = 5.5
ARUCO_MARGIN = 2.0

# Logo LUCENS IA en BAS
LOGO_TEXT = 'LUCENS IA'
LOGO_FONT_SIZE = 3.0
LOGO_CHAR_W = 3.2
LOGO_CHAR_GAP = 1.0
LOGO_Y_FROM_BOTTOM = 3.5

# Grille 3×3 patchs
GRID_COLS = 3
GRID_ROWS = 3
GRID_START_X = 3.0
GRID_START_Y = 15.5  # sous le QR
GRID_GAP = 1.2
GRID_W = CARD_W - 2 * GRID_START_X
GRID_BOTTOM_RESERVE = LOGO_Y_FROM_BOTTOM + LOGO_FONT_SIZE + 1.5
GRID_AVAILABLE_H = CARD_H - GRID_START_Y - GRID_BOTTOM_RESERVE
PATCH_W = (GRID_W - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS
PATCH_H = (GRID_AVAILABLE_H - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS

# Seed pour reproductibilité (chaque carte du même serial = identique)
RNG = np.random.RandomState(42)  # seed fixe = mêmes textures pour chaque carte du serial

TEXTURE_NAMES = [
    'POUSSIERE',    # 1 — constellation grains poussière densité variable
    'TACHE',        # 2 — tache liquide séché organique
    'COULEE',       # 3 — coulée verticale (smear)
    'EMPREINTE',    # 4 — courbes empreinte digitale
    'FIBRES',       # 5 — fibres textiles entrelacées
    'CROUTE',       # 6 — croûte écaillée multi-couches
    'CRATERES',     # 7 — cratères concaves
    'VEINES',       # 8 — réseau de veines ramifiées
    'GRAIN',        # 9 — grain dégradé densité variable
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
    parts = []
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    module = QR_SIZE / n
    origin_x = QR_CX - QR_SIZE / 2
    origin_y_stl = CARD_H - (QR_CY - QR_SIZE / 2) - QR_SIZE
    # Fond fluo
    parts.append(box_at(origin_x - 0.7, origin_y_stl - 0.7,
                        CARD_THICKNESS, QR_SIZE + 1.4, QR_SIZE + 1.4, RELIEF_HEIGHT))
    # Modules noirs
    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                mx = origin_x + col * module
                my = origin_y_stl + (n - 1 - row) * module
                parts.append(box_at(mx, my, CARD_THICKNESS + RELIEF_HEIGHT,
                                    module, module, 0.30))
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
    parts.append(box_at(corner_x, y_stl, CARD_THICKNESS,
                        ARUCO_SIZE, ARUCO_SIZE, RELIEF_HEIGHT))
    for r in range(6):
        for c in range(6):
            is_border = (r == 0 or r == 5 or c == 0 or c == 5)
            if is_border or pattern[r-1][c-1] == 1:
                mx = corner_x + c * cell
                my = y_stl + (5 - r) * cell
                parts.append(box_at(mx, my, CARD_THICKNESS + RELIEF_HEIGHT,
                                    cell, cell, 0.30))
    return parts


def build_all_arucos_split():
    """Retourne (fluo_parts, black_parts)."""
    fluo, black = [], []
    for marker_id, corner in enumerate([
        (ARUCO_MARGIN, ARUCO_MARGIN),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, ARUCO_MARGIN),
        (ARUCO_MARGIN, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
        (CARD_W - ARUCO_MARGIN - ARUCO_SIZE, CARD_H - ARUCO_MARGIN - ARUCO_SIZE),
    ]):
        parts = build_aruco(corner[0], corner[1], marker_id)
        fluo.append(parts[0])
        black.extend(parts[1:])
    return fluo, black


# ─── Logo LUCENS IA en BAS ──────────────────────────────────────────
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
    total_w = len(LOGO_TEXT) * LOGO_CHAR_W + (len(LOGO_TEXT) - 1) * LOGO_CHAR_GAP
    x_cursor = (CARD_W - total_w) / 2  # centré horizontalement
    y_stl = LOGO_Y_FROM_BOTTOM
    for ch in LOGO_TEXT:
        g = GLYPHS_5x7.get(ch, GLYPHS_5x7[' '])
        for ri, row in enumerate(g):
            for ci, p in enumerate(row):
                if p == '1':
                    px = x_cursor + ci * pixel_w
                    py = y_stl + (6 - ri) * pixel_h
                    parts.append(box_at(px, py, CARD_THICKNESS,
                                        pixel_w * 1.06, pixel_h * 1.06, RELIEF_HEIGHT))
        x_cursor += LOGO_CHAR_W + LOGO_CHAR_GAP
    return parts


# ─── 9 textures ORGANIQUES RÉALISTES ──────────────────────────────────
def build_patch_base(col, row):
    x = GRID_START_X + col * (PATCH_W + GRID_GAP)
    y_top_val = GRID_START_Y + row * (PATCH_H + GRID_GAP)
    y_stl = y_top(y_top_val, PATCH_H)
    base = box_at(x, y_stl, CARD_THICKNESS, PATCH_W, PATCH_H, RELIEF_HEIGHT)
    return base, x, y_stl


def _rng_for_patch(idx):
    """RNG dérivée du patch pour reproductibilité par carte."""
    return np.random.RandomState(1000 + idx * 17)


def texture_poussiere(x, y, rng):
    """1. POUSSIÈRE : constellation aléatoire de grains, densité variable.
    Imite une accumulation de poussière sous UV (grains de 0.3-0.7 mm)."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_grains = 70
    for _ in range(n_grains):
        # Densité plus forte au centre (gaussienne)
        u = rng.random()
        if u < 0.6:
            # 60% des grains regroupés vers le centre
            cx = x + PATCH_W/2 + rng.normal(0, PATCH_W/5)
            cy = y + PATCH_H/2 + rng.normal(0, PATCH_H/5)
        else:
            # 40% éparpillés
            cx = x + 0.4 + rng.random() * (PATCH_W - 0.8)
            cy = y + 0.4 + rng.random() * (PATCH_H - 0.8)
        if not (x + 0.3 < cx < x + PATCH_W - 0.3): continue
        if not (y + 0.3 < cy < y + PATCH_H - 0.3): continue
        size = 0.3 + rng.random() * 0.4
        h_relief = 0.20 + rng.random() * 0.18
        parts.append(box_at(cx - size/2, cy - size/2, z0, size, size, h_relief))
    return parts


def texture_tache(x, y, rng):
    """2. TACHE LIQUIDE SÉCHÉ : forme organique avec halo périphérique.
    Imite une goutte de lait/sang/jus séchée sous UV."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    cx = x + PATCH_W * (0.4 + rng.random() * 0.2)
    cy = y + PATCH_H * (0.4 + rng.random() * 0.2)
    # Corps central denses + halo périphérique (anneau de séchage)
    # Corps : 30 carrés dans un rayon r1
    r1 = min(PATCH_W, PATCH_H) * 0.20
    for _ in range(30):
        ang = rng.random() * 2 * np.pi
        rad = rng.random() ** 1.5 * r1
        px = cx + rad * np.cos(ang)
        py = cy + rad * np.sin(ang)
        if not (x + 0.3 < px < x + PATCH_W - 0.3): continue
        if not (y + 0.3 < py < y + PATCH_H - 0.3): continue
        size = 0.4 + rng.random() * 0.3
        parts.append(box_at(px - size/2, py - size/2, z0, size, size, 0.30))
    # Halo périphérique : ring de gouttelettes à r2 ≈ 1.5×r1
    r2 = r1 * 1.5
    for _ in range(20):
        ang = rng.random() * 2 * np.pi
        rad = r2 + rng.normal(0, r2 * 0.15)
        px = cx + rad * np.cos(ang)
        py = cy + rad * np.sin(ang)
        if not (x + 0.3 < px < x + PATCH_W - 0.3): continue
        if not (y + 0.3 < py < y + PATCH_H - 0.3): continue
        size = 0.3 + rng.random() * 0.2
        parts.append(box_at(px - size/2, py - size/2, z0, size, size, 0.22))
    return parts


def texture_coulee(x, y, rng):
    """3. COULÉE VERTICALE : trace de liquide qui a coulé.
    Imite une coulée le long d'une paroi (sauce, sang, eau sale)."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    # 2-3 coulées principales en diagonale descendante
    n_coulees = 2 + rng.randint(0, 2)
    for c in range(n_coulees):
        start_x = x + 1.0 + (c + 0.5) * (PATCH_W - 2.0) / n_coulees
        drift = rng.normal(0, 0.4)
        n_seg = 14
        for s in range(n_seg):
            t = s / (n_seg - 1)
            wx = start_x + t * drift
            wy = y + 0.5 + t * (PATCH_H - 1.0)
            # Largeur décroit en bas (effet de séchage)
            w_loc = 0.45 - t * 0.15 + rng.normal(0, 0.05)
            w_loc = max(0.25, w_loc)
            h_loc = 0.55 + rng.random() * 0.4  # hauteur seg
            parts.append(box_at(wx - w_loc/2, wy - h_loc/2, z0, w_loc, h_loc, 0.28))
    return parts


def texture_empreinte(x, y, rng):
    """4. EMPREINTE DIGITALE : courbes parallèles imitant les sillons.
    Imite un dépôt fluorescent suivant une empreinte de doigt."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    # 7 boucles concentriques quasi-ellipses légèrement déformées
    n_loops = 6
    for i in range(n_loops):
        rx = (i + 1) * PATCH_W * 0.07
        ry = (i + 1) * PATCH_H * 0.09
        # Décale chaque boucle aléatoirement
        ox = rng.normal(0, 0.15)
        oy = rng.normal(0, 0.15)
        segs = 36
        for s in range(segs):
            ang = s * 2 * np.pi / segs
            # Perturbation du rayon
            jitter = 1 + rng.normal(0, 0.04)
            px = cx + ox + rx * jitter * np.cos(ang)
            py = cy + oy + ry * jitter * np.sin(ang)
            if not (x + 0.3 < px < x + PATCH_W - 0.3): continue
            if not (y + 0.3 < py < y + PATCH_H - 0.3): continue
            parts.append(box_at(px - 0.18, py - 0.18, z0, 0.36, 0.36, 0.26))
    return parts


def texture_fibres(x, y, rng):
    """5. FIBRES TEXTILES : filaments fins entrelacés.
    Imite des fibres de coton/chiffon prises au UV."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_fibres = 10
    for _ in range(n_fibres):
        # Position de départ aléatoire + angle aléatoire
        sx = x + 0.5 + rng.random() * (PATCH_W - 1.0)
        sy = y + 0.5 + rng.random() * (PATCH_H - 1.0)
        ang = rng.random() * 2 * np.pi
        length = 1.5 + rng.random() * 2.0
        # Construit la fibre par segments
        n_seg = 8
        for s in range(n_seg):
            t = s / (n_seg - 1)
            px = sx + np.cos(ang) * t * length + rng.normal(0, 0.08)
            py = sy + np.sin(ang) * t * length + rng.normal(0, 0.08)
            if not (x + 0.3 < px < x + PATCH_W - 0.3): continue
            if not (y + 0.3 < py < y + PATCH_H - 0.3): continue
            parts.append(box_at(px - 0.12, py - 0.12, z0, 0.24, 0.24, 0.24))
    return parts


def texture_croute(x, y, rng):
    """6. CROÛTE ÉCAILLÉE : plaques irrégulières superposées.
    Imite une croûte de résidu sec qui s'écaille (calcaire, sucre)."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_plates = 10
    for _ in range(n_plates):
        pw = 0.8 + rng.random() * 1.4
        ph = 0.6 + rng.random() * 1.0
        px = x + 0.4 + rng.random() * (PATCH_W - pw - 0.8)
        py = y + 0.4 + rng.random() * (PATCH_H - ph - 0.8)
        h_relief = 0.20 + rng.random() * 0.30
        parts.append(box_at(px, py, z0, pw, ph, h_relief))
    return parts


def texture_crateres(x, y, rng):
    """7. CRATÈRES : cercles concaves (anneaux uniquement).
    Imite des bulles éclatées, taches en anneau (urine séchée)."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    n_craters = 7
    for _ in range(n_craters):
        cx = x + 1.0 + rng.random() * (PATCH_W - 2.0)
        cy = y + 0.8 + rng.random() * (PATCH_H - 1.6)
        r_outer = 0.7 + rng.random() * 0.6
        segs = 18
        for s in range(segs):
            ang = s * 2 * np.pi / segs
            px = cx + r_outer * np.cos(ang)
            py = cy + r_outer * np.sin(ang)
            if not (x + 0.3 < px < x + PATCH_W - 0.3): continue
            if not (y + 0.3 < py < y + PATCH_H - 0.3): continue
            parts.append(box_at(px - 0.18, py - 0.18, z0, 0.36, 0.36, 0.32))
    return parts


def texture_veines(x, y, rng):
    """8. RÉSEAU DE VEINES : lignes ramifiées (style biofilm/moisissure).
    Imite un développement bactérien/fongique."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    # 3 branches principales depuis un point central
    cx = x + PATCH_W / 2 + rng.normal(0, 0.5)
    cy = y + PATCH_H / 2 + rng.normal(0, 0.5)
    n_branches = 4
    for b in range(n_branches):
        base_ang = b * 2 * np.pi / n_branches + rng.normal(0, 0.3)
        # Branche principale
        cur_x, cur_y = cx, cy
        cur_ang = base_ang
        n_seg = 12
        for s in range(n_seg):
            cur_ang += rng.normal(0, 0.25)  # serpente
            step = 0.4
            cur_x += np.cos(cur_ang) * step
            cur_y += np.sin(cur_ang) * step
            if not (x + 0.3 < cur_x < x + PATCH_W - 0.3): break
            if not (y + 0.3 < cur_y < y + PATCH_H - 0.3): break
            parts.append(box_at(cur_x - 0.15, cur_y - 0.15, z0, 0.30, 0.30, 0.26))
            # Petite branche secondaire
            if s > 3 and rng.random() < 0.25:
                sub_x, sub_y = cur_x, cur_y
                sub_ang = cur_ang + rng.choice([-1, 1]) * (np.pi/3)
                for ss in range(4):
                    sub_x += np.cos(sub_ang) * 0.35
                    sub_y += np.sin(sub_ang) * 0.35
                    if not (x + 0.3 < sub_x < x + PATCH_W - 0.3): break
                    if not (y + 0.3 < sub_y < y + PATCH_H - 0.3): break
                    parts.append(box_at(sub_x - 0.12, sub_y - 0.12, z0, 0.24, 0.24, 0.22))
    return parts


def texture_grain(x, y, rng):
    """9. GRAIN DÉGRADÉ : densité variable du grain (du dense au lâche).
    Imite un nuage de particules de densité variable."""
    parts = []
    z0 = CARD_THICKNESS + RELIEF_HEIGHT
    # Densité varie verticalement : dense en haut, lâche en bas
    n_total = 90
    for _ in range(n_total):
        # Y biaisé vers le haut
        u = rng.random()
        py = y + 0.4 + (u ** 2) * (PATCH_H - 0.8)
        px = x + 0.4 + rng.random() * (PATCH_W - 0.8)
        if rng.random() > (1 - u):  # plus de chance d'être skippé bas
            continue
        size = 0.22 + rng.random() * 0.20
        h_relief = 0.18 + rng.random() * 0.16
        parts.append(box_at(px - size/2, py - size/2, z0, size, size, h_relief))
    return parts


TEXTURE_BUILDERS = {
    'POUSSIERE': texture_poussiere,
    'TACHE':     texture_tache,
    'COULEE':    texture_coulee,
    'EMPREINTE': texture_empreinte,
    'FIBRES':    texture_fibres,
    'CROUTE':    texture_croute,
    'CRATERES':  texture_crateres,
    'VEINES':    texture_veines,
    'GRAIN':     texture_grain,
}


def build_card_mesh():
    print(f'V6 — Carte Lucens textures organiques, serial: {SERIAL}')
    base = box_at(0, 0, 0, CARD_W, CARD_H, CARD_THICKNESS)
    print(f'  Base solide {CARD_W}x{CARD_H}x{CARD_THICKNESS} mm')

    all_fluo, all_black = [], []

    # 9 patchs
    for idx, name in enumerate(TEXTURE_NAMES):
        col = idx % GRID_COLS
        row = idx // GRID_COLS
        plateau, x, y = build_patch_base(col, row)
        all_fluo.append(plateau)
        rng = _rng_for_patch(idx)
        all_fluo.extend(TEXTURE_BUILDERS[name](x, y, rng))
    print(f'  9 plateaux fluo + textures organiques (seed reproductible)')

    # Logo en bas
    all_fluo.extend(build_logo())
    print(f'  Logo LUCENS IA centré en BAS')

    # QR en haut
    qr_parts = build_qr_zone()
    all_fluo.append(qr_parts[0])
    all_black.extend(qr_parts[1:])
    print(f'  QR fond fluo + {len(qr_parts)-1} modules noirs (haut-centre)')

    # ArUco
    aruco_fluo, aruco_black = build_all_arucos_split()
    all_fluo.extend(aruco_fluo)
    all_black.extend(aruco_black)
    print(f'  4 ArUco aux coins')

    print('  Boolean union base + reliefs...')
    all_meshes = [base] + all_fluo + all_black
    card = trimesh.util.concatenate(all_meshes)
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
        'version': 'V6 (textures organiques réalistes)',
        'serial': SERIAL,
        'qr_payload': QR_TEXT,
        'dimensions_mm': {'width': CARD_W, 'height': CARD_H, 'thickness': CARD_THICKNESS},
        'patches': {
            'count': len(TEXTURE_NAMES), 'layout': f'{GRID_COLS}x{GRID_ROWS}',
            'patch_dimensions_mm': {'w': round(PATCH_W, 2), 'h': round(PATCH_H, 2)},
            'textures': {
                'POUSSIERE': 'Constellation grains de poussière, densité gaussienne',
                'TACHE':     'Tache liquide séché avec halo périphérique',
                'COULEE':    'Coulées verticales (3 traces sèches)',
                'EMPREINTE': 'Boucles d empreinte digitale',
                'FIBRES':    'Fibres textiles entrelacées',
                'CROUTE':    'Croûte écaillée multi-couches',
                'CRATERES':  'Cratères concaves en anneaux',
                'VEINES':    'Réseau de veines ramifiées (style biofilm)',
                'GRAIN':     'Grain dégradé densité variable',
            },
        },
        'layout': {
            'QR': 'haut-centre',
            'logo_LUCENS_IA': 'bas-centre',
            'ArUco': '4 coins',
            'patches_grid': '3x3 au centre',
        },
        'print_strategy': {
            'method': 'bi-material CFS',
            'slot_1_noir': 'base + QR modules + ArUco cells',
            'slot_2_fluo': 'plateaux patches + reliefs textures + logo + fonds QR/ArUco',
        },
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f'carte-lucens-v6-{SERIAL}.json'
    p.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    return p


def main():
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    root = Path(__file__).resolve().parent.parent
    out_dir = root / 'docs' / 'carte-lucens-3d'
    stl_path = out_dir / 'carte-lucens-v6.stl'
    stl_root = root / 'carte-lucens-v6.stl'

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
    print('Carte V6 prete pour impression bi-mat CFS')


if __name__ == '__main__':
    main()

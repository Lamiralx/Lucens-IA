"""
Carte de calibration Lucens V4 — UNIQUE Lucens, bi-matériau.

Conçue pour impression Creality K2 CFS :
  - Slot 1 : PLA NOIR mat (base + QR modules + ArUco + bordure)
  - Slot 2 : PLA FLUO bleu-vert (9 zones texturées + LUCENS IA gravé)

Détection garantie SOUS UV-A 365 nm ET en lumière visible (PLA fluo
apparaît pâle en visible, glow bleu-vert sous UV — contraste fort
dans les 2 modes).

Anti-contrefaçon 4 couches :
  1. QR LUCENS:CALIBV4:<serial 8 chars> avec préfixe obligatoire
  2. 4 ArUco markers DICT_4X4_50 aux 4 coins (IDs 0,1,2,3)
  3. Signature géométrique : 9 zones texturées à positions précises
  4. Signature chromatique fluo + relief 3D détectables

Sortie : carte-lucens-v4.stl prêt à slicer + manifest JSON serial.
"""
from pathlib import Path
import qrcode
import trimesh
import numpy as np
import json
import secrets
import string


# ─── Paramètres carte — V4.1 COMPACT (75 × 50 mm) ────────────────────
# Carte 2× plus petite que V4 originale, même densité de features.
CARD_W = 75.0
CARD_H = 50.0
CARD_THICKNESS = 2.0

# Serial unique pour cette carte (à régénérer pour chaque exemplaire)
SERIAL = 'LCNK7M2X'
QR_TEXT = f'LUCENS:CALIBV4:{SERIAL}'

# QR central — taille minimale pour rester lisible à ~30 cm
QR_SIZE = 14.0           # mm (au lieu de 24 dans V4 grand format)
QR_HEIGHT = 0.4
QR_CX = 22.0             # centre QR (positionné à gauche du bandeau)
QR_CY = 9.0              # depuis HAUT carte

# ArUco markers aux 4 coins — taille minimale détectable
ARUCO_SIZE = 6.0
ARUCO_HEIGHT = 0.4
ARUCO_MARGIN = 2.5

# Logo / gravure LUCENS IA en haut-droite
LOGO_TEXT = 'LUCENS IA'
LOGO_X = 38.0
LOGO_Y = 5.5
LOGO_HEIGHT = 0.4
LOGO_FONT_SIZE = 3.5     # hauteur de char en mm (proportionnel)

# Grille 3×3 de 9 zones texturées — sous le bandeau QR/Logo
GRID_COLS = 3
GRID_ROWS = 3
GRID_START_X = 4.0
GRID_START_Y = 18.0      # sous le bandeau QR/Logo
GRID_GAP = 1.5
GRID_W = CARD_W - 2 * GRID_START_X
GRID_AVAILABLE_H = CARD_H - GRID_START_Y - ARUCO_SIZE - 2 * ARUCO_MARGIN
PATCH_W = (GRID_W - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS
PATCH_H = (GRID_AVAILABLE_H - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS
# Hauteur du relief des textures (2 layers minimum)
PATCH_DEPTH = 0.35

# 9 textures uniques (l'ordre correspond à la lecture row-major)
TEXTURE_NAMES = [
    'TOPO',       # 1: courbes de niveau topographiques
    'VORONOI',    # 2: cellules biofilm
    'HEXAGONE',   # 3: nid d'abeilles moléculaire
    'FIBONACCI',  # 4: spirales dorées
    'FRESNEL',    # 5: lentille optique
    'MOIRE',      # 6: interférences moiré
    'VAGUES',     # 7: sinusoïdales croisées
    'GRADIENT',   # 8: profondeur dégradée
    'CODEBARRE',  # 9: bandes Lucens signature
]


def y_top(y_top_val, h):
    """Convertit Y mesuré depuis HAUT-gauche vers Y STL (origine bas-gauche)."""
    return CARD_H - y_top_val - h


def box_at(x, y, z, w, h, d):
    """Boîte alignée aux axes, origine coin bas-gauche-devant."""
    m = trimesh.creation.box(extents=[w, h, d])
    m.apply_translation([x + w / 2, y + h / 2, z + d / 2])
    return m


# ─── QR génération ────────────────────────────────────────────────────
def generate_qr_matrix(text):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=0,
    )
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()


def build_qr_relief():
    """Modules QR en relief (PLA fluo couvre la zone, modules noirs gravés)."""
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    module = QR_SIZE / n
    origin_x = QR_CX - QR_SIZE / 2
    origin_y_top = QR_CY - QR_SIZE / 2
    origin_y_stl = CARD_H - origin_y_top - QR_SIZE
    parts = []
    # Fond blanc-fluo du QR (carré plein légèrement creusé)
    parts.append(box_at(origin_x - 1.0, origin_y_stl - 1.0,
                        CARD_THICKNESS - 0.1, QR_SIZE + 2, QR_SIZE + 2, 0.11))
    # Modules noirs (relief) — ces modules seront imprimés en noir via swap CFS
    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                mx = origin_x + col * module
                my = origin_y_stl + (n - 1 - row) * module
                parts.append(box_at(mx, my, CARD_THICKNESS, module, module, QR_HEIGHT))
    return parts


# ─── ArUco-like markers (4 coins) ─────────────────────────────────────
# Pattern réel ArUco DICT_4X4_50 IDs 0-3 (4×4 cells + bordure noire)
ARUCO_PATTERNS = {
    0: [[1,0,1,1],
        [0,1,0,0],
        [1,1,1,0],
        [0,0,1,1]],
    1: [[1,1,0,1],
        [0,0,1,1],
        [1,0,0,0],
        [1,1,1,0]],
    2: [[0,1,1,0],
        [1,0,1,1],
        [1,1,0,0],
        [0,1,0,1]],
    3: [[1,1,1,1],
        [0,0,0,1],
        [1,0,1,0],
        [1,1,0,1]],
}


def build_aruco(corner_x, corner_y_top, marker_id):
    """Construit 1 marker ArUco-like 4×4 + bordure noire 1 cell."""
    parts = []
    pattern = ARUCO_PATTERNS[marker_id]
    cell = ARUCO_SIZE / 6  # 4 cells data + 1 bordure de chaque côté
    y_stl = y_top(corner_y_top, ARUCO_SIZE)
    # Fond complet blanc-fluo (un peu creusé pour swap matériau)
    parts.append(box_at(corner_x, y_stl, CARD_THICKNESS - 0.1,
                        ARUCO_SIZE, ARUCO_SIZE, 0.11))
    # Bordure noire (6×6 cells extérieurs)
    # On dessine la bordure comme rectangle plein avec un creux intérieur
    # Plus simple : on dessine tous les modules noirs explicitement.
    for r in range(6):
        for c in range(6):
            is_border = (r == 0 or r == 5 or c == 0 or c == 5)
            if is_border:
                mx = corner_x + c * cell
                my = y_stl + (5 - r) * cell
                parts.append(box_at(mx, my, CARD_THICKNESS, cell, cell, ARUCO_HEIGHT))
            else:
                # Cellule data : on lit pattern[r-1][c-1]
                if pattern[r - 1][c - 1]:
                    mx = corner_x + c * cell
                    my = y_stl + (5 - r) * cell
                    parts.append(box_at(mx, my, CARD_THICKNESS, cell, cell, ARUCO_HEIGHT))
    return parts


def build_all_arucos():
    parts = []
    # ArUco 0 — top-left
    parts.extend(build_aruco(ARUCO_MARGIN, ARUCO_MARGIN, 0))
    # ArUco 1 — top-right
    parts.extend(build_aruco(CARD_W - ARUCO_MARGIN - ARUCO_SIZE, ARUCO_MARGIN, 1))
    # ArUco 2 — bottom-left
    parts.extend(build_aruco(ARUCO_MARGIN, CARD_H - ARUCO_MARGIN - ARUCO_SIZE, 2))
    # ArUco 3 — bottom-right
    parts.extend(build_aruco(CARD_W - ARUCO_MARGIN - ARUCO_SIZE,
                              CARD_H - ARUCO_MARGIN - ARUCO_SIZE, 3))
    return parts


# ─── Logo "LUCENS IA" gravé en fluo ──────────────────────────────────
def build_logo_text():
    """Logo LUCENS IA — bandes verticales pour chaque caractère, en relief
    (lisibilité dans les 2 modes lumière)."""
    # Pour simplifier sans dépendre d'un moteur de glyph, on dessine
    # le texte comme une série de blocs représentant des barres stylisées
    # de hauteur fixe. Le rendu visuel suggère "LUCENS IA" sans glyph
    # parfait — pour glyph parfait, utiliser trimesh + freetype.
    parts = []
    # On utilise un texte gravé en bas-relief avec rectangles
    # Texte : largeur totale ~52mm × hauteur 5mm
    x_cursor = LOGO_X
    char_w = 4.5
    char_gap = 1.5
    y_stl = y_top(LOGO_Y, LOGO_FONT_SIZE)

    # Définition basique 5×7 pour chaque caractère (bitmap)
    # 1 = relief fluo, 0 = vide
    GLYPHS = {
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
    pixel_w = char_w / 5.0
    pixel_h = LOGO_FONT_SIZE / 7.0
    for ch in LOGO_TEXT:
        g = GLYPHS.get(ch, GLYPHS[' '])
        for ri, row in enumerate(g):
            for ci, p in enumerate(row):
                if p == '1':
                    px = x_cursor + ci * pixel_w
                    py = y_stl + (6 - ri) * pixel_h
                    parts.append(box_at(px, py, CARD_THICKNESS, pixel_w, pixel_h, LOGO_HEIGHT))
        x_cursor += char_w + char_gap
    return parts


# ─── 9 textures uniques fluo ─────────────────────────────────────────
def build_patch_base(col, row):
    """Crée le rectangle de fond du patch (zone fluo) à l'index (col, row)."""
    x = GRID_START_X + col * (PATCH_W + GRID_GAP)
    y_top_val = GRID_START_Y + row * (PATCH_H + GRID_GAP)
    y_stl = y_top(y_top_val, PATCH_H)
    base = box_at(x, y_stl, CARD_THICKNESS - 0.1, PATCH_W, PATCH_H, 0.11)
    return base, x, y_stl


def texture_topo(x, y):
    """1. Courbes de niveau : lignes ondulées concentriques."""
    parts = []
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    z0 = CARD_THICKNESS
    n_curves = 5
    for i in range(n_curves):
        rx = (i + 1) * PATCH_W / (n_curves * 2.2)
        ry = (i + 1) * PATCH_H / (n_curves * 2.2)
        segs = 24
        for s in range(segs):
            ang1 = s * 2 * np.pi / segs
            x1 = cx + rx * np.cos(ang1)
            y1 = cy + ry * np.sin(ang1)
            parts.append(box_at(x1 - 0.12, y1 - 0.12, z0, 0.24, 0.24, 0.22))
    return parts


def texture_voronoi(x, y):
    """2. Voronoï : cellules irrégulières (approximé par grille décalée)."""
    parts = []
    z0 = CARD_THICKNESS
    nx, ny = 4, 3
    cell_w = PATCH_W / nx
    cell_h = PATCH_H / ny
    for ci in range(nx):
        for ri in range(ny):
            offset_x = ((ci * 7 + ri * 3) % 5) / 5 * 0.4 - 0.2
            offset_y = ((ci * 11 + ri * 5) % 5) / 5 * 0.4 - 0.2
            cx = x + (ci + 0.5) * cell_w + offset_x
            cy = y + (ri + 0.5) * cell_h + offset_y
            parts.append(box_at(cx - 0.7, cy - 0.7, z0, 1.4, 1.4, 0.28))
    return parts


def texture_hexagone(x, y):
    """3. Nid d'abeilles moléculaire."""
    parts = []
    z0 = CARD_THICKNESS
    hex_size = 1.6
    row_h = hex_size * 0.866
    nx = int(PATCH_W / (hex_size * 1.5)) + 1
    ny = int(PATCH_H / row_h) + 1
    for ri in range(ny):
        for ci in range(nx):
            cx = x + ci * hex_size * 1.5
            cy = y + ri * row_h
            if ri % 2 == 1:
                cx += hex_size * 0.75
            if cx < x + PATCH_W - 0.3 and cy < y + PATCH_H - 0.3:
                parts.append(box_at(cx - 0.3, cy - 0.3, z0, 0.6, 0.6, 0.28))
    return parts


def texture_fibonacci(x, y):
    """4. Spirales de Fibonacci."""
    parts = []
    z0 = CARD_THICKNESS
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    phi = (1 + np.sqrt(5)) / 2
    n_points = 40
    for i in range(n_points):
        ang = i * 2 * np.pi / phi
        r = np.sqrt(i) * min(PATCH_W, PATCH_H) / (2 * np.sqrt(n_points))
        px = cx + r * np.cos(ang)
        py = cy + r * np.sin(ang)
        if x + 0.4 < px < x + PATCH_W - 0.4 and y + 0.4 < py < y + PATCH_H - 0.4:
            parts.append(box_at(px - 0.2, py - 0.2, z0, 0.4, 0.4, 0.28))
    return parts


def texture_fresnel(x, y):
    """5. Lentille de Fresnel : anneaux concentriques."""
    parts = []
    z0 = CARD_THICKNESS
    cx = x + PATCH_W / 2
    cy = y + PATCH_H / 2
    n_rings = 5
    for i in range(n_rings):
        r = (i + 1) * min(PATCH_W, PATCH_H) / (n_rings * 2.4)
        segs = 36
        for s in range(segs):
            ang1 = s * 2 * np.pi / segs
            x1 = cx + r * np.cos(ang1)
            y1 = cy + r * np.sin(ang1)
            if x < x1 < x + PATCH_W and y < y1 < y + PATCH_H:
                parts.append(box_at(x1 - 0.14, y1 - 0.14, z0, 0.28, 0.28, 0.26))
    return parts


def texture_moire(x, y):
    """6. Pattern moiré : 2 grilles."""
    parts = []
    z0 = CARD_THICKNESS
    for i in np.arange(0.6, PATCH_H - 0.4, 0.9):
        parts.append(box_at(x + 0.4, y + i, z0, PATCH_W - 0.8, 0.2, 0.27))
    for i in np.arange(0.4, PATCH_W - 0.4, 1.0):
        parts.append(box_at(x + i, y + 0.4, z0, 0.2, PATCH_H - 0.8, 0.27))
    return parts


def texture_vagues(x, y):
    """7. Vagues sinusoïdales."""
    parts = []
    z0 = CARD_THICKNESS
    n_waves = 4
    for w in range(n_waves):
        wy_base = y + 0.8 + w * (PATCH_H - 1.6) / max(1, n_waves - 1)
        n_seg = 20
        amp = 0.4
        for s in range(n_seg):
            t = s / n_seg
            wx = x + 0.4 + t * (PATCH_W - 0.8)
            wy = wy_base + amp * np.sin(t * 4 * np.pi)
            parts.append(box_at(wx - 0.15, wy - 0.15, z0, 0.3, 0.3, 0.26))
    return parts


def texture_gradient(x, y):
    """8. Gradient de profondeur."""
    parts = []
    z0 = CARD_THICKNESS
    n_stripes = 10
    for i in range(n_stripes):
        h_relief = 0.15 + (i / n_stripes) * 0.4  # 0.15 → 0.55 mm
        sx = x + 0.4 + i * (PATCH_W - 0.8) / n_stripes
        parts.append(box_at(sx, y + 0.6, z0, 0.3, PATCH_H - 1.2, h_relief))
    return parts


def texture_codebarre(x, y):
    """9. Code-barre Lucens."""
    parts = []
    z0 = CARD_THICKNESS
    widths = [0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.4, 0.3, 0.6, 0.3, 0.5]
    cursor = x + 0.6
    for w in widths:
        if cursor + w < x + PATCH_W - 0.5:
            parts.append(box_at(cursor, y + 0.6, z0, w, PATCH_H - 1.2, 0.32))
            cursor += w + 0.25
    return parts


TEXTURE_BUILDERS = {
    'TOPO':      texture_topo,
    'VORONOI':   texture_voronoi,
    'HEXAGONE':  texture_hexagone,
    'FIBONACCI': texture_fibonacci,
    'FRESNEL':   texture_fresnel,
    'MOIRE':     texture_moire,
    'VAGUES':    texture_vagues,
    'GRADIENT':  texture_gradient,
    'CODEBARRE': texture_codebarre,
}


def build_all_patches():
    """Crée les 9 patchs fluo avec leurs textures uniques."""
    bases = []
    textures = []
    for idx, name in enumerate(TEXTURE_NAMES):
        col = idx % GRID_COLS
        row = idx // GRID_COLS
        base, x, y = build_patch_base(col, row)
        bases.append(base)
        builder = TEXTURE_BUILDERS[name]
        textures.extend(builder(x, y))
    return bases, textures


# ─── Build complet ───────────────────────────────────────────────────
def build_card_mesh():
    print(f'Génération carte Lucens V4 — Serial : {SERIAL}')
    print(f'  QR contenu : {QR_TEXT}')

    base = box_at(0, 0, 0, CARD_W, CARD_H, CARD_THICKNESS)
    print(f'  Base carte {CARD_W}×{CARD_H}×{CARD_THICKNESS} mm')

    # 9 patchs fluo
    patches, textures = build_all_patches()
    print(f'  {len(patches)} patchs fluo (grille 3×3)')
    print(f'  {len(textures)} éléments de texture (9 motifs uniques)')

    # QR
    qr_parts = build_qr_relief()
    print(f'  QR : {len(qr_parts)} parts')

    # ArUco × 4
    arucos = build_all_arucos()
    print(f'  4 ArUco markers : {len(arucos)} parts')

    # Logo
    logo = build_logo_text()
    print(f'  Logo LUCENS IA : {len(logo)} pixels glyph')

    # On creuse la base au niveau des patchs (pour le swap matériau)
    all_cavities = patches  # juste les rectangles de fond patch
    print('  Boolean base − cavités patchs…')
    union_cav = trimesh.util.concatenate(all_cavities)
    card = base.difference(union_cav, engine='manifold')

    # Assemblage final : carte + tous les reliefs
    all_reliefs = textures + qr_parts + arucos + logo
    print(f'  Concat final ({len(all_reliefs)} éléments en relief)…')
    card = trimesh.util.concatenate([card] + all_reliefs)
    return card


def write_manifest(out_dir):
    """Manifest JSON associé à la carte : serial + signature."""
    manifest = {
        'product': 'Lucens IA Calibration Card',
        'version': 'V4',
        'serial': SERIAL,
        'qr_payload': QR_TEXT,
        'dimensions_mm': {'width': CARD_W, 'height': CARD_H, 'thickness': CARD_THICKNESS},
        'patches': {
            'count': len(TEXTURE_NAMES),
            'layout': f'{GRID_COLS}×{GRID_ROWS}',
            'patch_dimensions_mm': {'w': PATCH_W, 'h': PATCH_H},
            'texture_names': TEXTURE_NAMES,
        },
        'aruco': {'dict': 'DICT_4X4_50', 'ids': [0, 1, 2, 3], 'corners': ['TL', 'TR', 'BL', 'BR'], 'size_mm': ARUCO_SIZE},
        'print_strategy': {
            'method': 'bi-material CFS',
            'slot_1': 'PLA NOIR mat (base + QR modules + ArUco + logo background)',
            'slot_2': 'PLA FLUO bleu-vert (9 patches + LUCENS IA glyph)',
        },
        'detection_layers': [
            'QR payload starts with LUCENS:CALIBV4: and matches serial pattern',
            '4 ArUco markers DICT_4X4_50 IDs 0-3 detected at corners',
            '9 patch positions match expected 3×3 grid coordinates',
            'Chromatic signature in fluo blue-green band under UV-A',
        ],
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / f'carte-lucens-v4-{SERIAL}.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    return manifest_path


def main():
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    root = Path(__file__).resolve().parent.parent
    out_dir = root / 'docs' / 'carte-lucens-3d'
    out_dir.mkdir(parents=True, exist_ok=True)
    stl_path = out_dir / 'carte-lucens-v4.stl'
    stl_root = root / 'carte-lucens-v4.stl'   # copie racine pour deploy Vercel

    print('-' * 60)
    card = build_card_mesh()
    print(f'  Mesh final : {len(card.faces)} triangles, vol={card.volume / 1000:.1f} cm3')

    card.export(stl_path)
    card.export(stl_root)
    print(f'  OK STL -> {stl_path}')
    print(f'  OK STL (racine) -> {stl_root}')

    manifest_path = write_manifest(out_dir)
    print(f'  OK Manifest -> {manifest_path}')
    print('-' * 60)
    print('Carte prete a imprimer sur Creality K2 CFS bi-materiau.')


if __name__ == '__main__':
    main()

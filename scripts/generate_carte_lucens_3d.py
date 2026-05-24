"""
Générateur du modèle 3D de la carte de calibration Lucens V3 — UNIQUE Lucens.

Carte spécialement conçue pour calibrer toute la chaîne Lucens IA :
  - QR Lucens central (authentification + référence géométrique fiducial)
  - 4 marqueurs fiducials aux coins (rectification perspective robuste)
  - 4 cuvettes échelle de gris (à peindre : blanc/gris25/gris50/noir)
    → calibre la courbe gamma du capteur
  - 4 cuvettes fluo avec textures UNIQUES par patch (à peindre acrylique UV)
    → calibre les signatures fluo + résolution spatiale par type de motif
  - Mire de résolution spatiale (lignes parallèles 0.2/0.5/1mm)
    → calibre la netteté effective de la chaîne optique
  - Barre d'échelle 10 mm calibrée
    → conversion pixels → mm pour mesures réelles
  - Logo "L" Lucens embossé (signature de marque + auth secondaire)
  - Zone code série (à graver/peindre individuellement)

Produit DEUX fichiers :
  1. carte-lucens-v3.scad  → OpenSCAD paramétrique
  2. carte-lucens-v3.stl   → STL prêt à slicer Creality K2

Dépendances : pip install qrcode trimesh numpy
Usage : python scripts/generate_carte_lucens_3d.py
"""

from pathlib import Path
import qrcode
import trimesh
import numpy as np


# ─── Paramètres carte (mm) ────────────────────────────────────────────
CARD_W = 150.0
CARD_H = 100.0
CARD_THICKNESS = 2.5

QR_TEXT = 'LUCENS:CALIBV3'
QR_SIZE = 20.0
QR_HEIGHT = 0.4
QR_CENTER_X = 18.0           # top-left
QR_CENTER_Y = 18.0

# Marqueurs fiducials aux 4 coins (carrés noir/blanc simples, 6×6 mm)
FIDUCIAL_SIZE = 6.0
FIDUCIAL_HEIGHT = 0.4
FIDUCIAL_MARGIN = 5.0

# Échelle de gris : 4 cuvettes 18×18 mm
GRAY_PATCH_SIZE = 18.0
GRAY_DEPTH = 0.6
GRAY_START_X = 36.0          # juste à droite du QR
GRAY_START_Y = 8.0           # ligne du haut
GRAY_GAP = 4.0

# Patchs fluo : 4 cuvettes 24×24 mm avec textures uniques
FLUO_PATCH_SIZE = 24.0
FLUO_DEPTH = 0.8
FLUO_START_X = 36.0
FLUO_START_Y = 36.0          # sous l'échelle de gris
FLUO_GAP = 4.0

# Textures dans les cuvettes fluo (hauteur des reliefs)
TEXTURE_HEIGHT = 0.20

# Mire de résolution : 3 zones de lignes parallèles
RESO_ZONE_W = 36.0
RESO_ZONE_H = 6.0
RESO_START_X = 36.0
RESO_START_Y = 70.0          # sous les fluo
RESO_LINE_HEIGHT = 0.25

# Barre d'échelle 10 mm
SCALE_BAR_LEN = 10.0
SCALE_BAR_W = 1.5
SCALE_BAR_X = 80.0
SCALE_BAR_Y = 92.0
SCALE_BAR_HEIGHT = 0.35

# Logo Lucens "L" embossé
LOGO_X = 8.0
LOGO_Y = 75.0
LOGO_HEIGHT = 0.4

# Zone code série (à peindre/graver individuellement)
SERIAL_ZONE_X = 8.0
SERIAL_ZONE_Y = 88.0
SERIAL_ZONE_W = 24.0
SERIAL_ZONE_H = 6.0
SERIAL_FRAME_HEIGHT = 0.3


# ─── Génération QR matrix ─────────────────────────────────────────────
def generate_qr_matrix(text: str):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=1,
        border=0,
    )
    qr.add_data(text)
    qr.make(fit=True)
    return qr.get_matrix()


# ─── Helpers STL ──────────────────────────────────────────────────────
def box(w, h, d, x=0, y=0, z=0):
    """Boîte alignée aux axes (origine = coin BAS-GAUCHE-DEVANT)."""
    m = trimesh.creation.box(extents=[w, h, d])
    m.apply_translation([x + w/2, y + h/2, z + d/2])
    return m


def y_top_to_stl(y_top, h_box):
    """Convertit Y mesuré depuis HAUT-gauche carte vers Y STL (origine bas-gauche)."""
    return CARD_H - y_top - h_box


# ─── Génération QR en relief ──────────────────────────────────────────
def build_qr_modules():
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    module_size = QR_SIZE / n
    qr_origin_x = QR_CENTER_X - QR_SIZE / 2
    qr_origin_y_top = QR_CENTER_Y - QR_SIZE / 2
    qr_origin_y = CARD_H - qr_origin_y_top - QR_SIZE
    boxes = []
    for row in range(n):
        for col in range(n):
            if matrix[row][col]:
                mx = qr_origin_x + col * module_size
                my = qr_origin_y + (n - 1 - row) * module_size
                boxes.append(box(module_size, module_size, QR_HEIGHT,
                                 mx, my, CARD_THICKNESS))
    return boxes


# ─── Marqueurs fiducials aux 4 coins ──────────────────────────────────
def build_fiducial(corner_x, corner_y_top):
    """Carré simple en relief — utilisé comme marqueur géométrique."""
    y = y_top_to_stl(corner_y_top, FIDUCIAL_SIZE)
    return box(FIDUCIAL_SIZE, FIDUCIAL_SIZE, FIDUCIAL_HEIGHT,
               corner_x, y, CARD_THICKNESS)


def build_all_fiducials():
    fids = []
    # Top-right
    fids.append(build_fiducial(CARD_W - FIDUCIAL_MARGIN - FIDUCIAL_SIZE,
                               FIDUCIAL_MARGIN))
    # Bottom-left
    fids.append(build_fiducial(FIDUCIAL_MARGIN,
                               CARD_H - FIDUCIAL_MARGIN - FIDUCIAL_SIZE))
    # Bottom-right
    fids.append(build_fiducial(CARD_W - FIDUCIAL_MARGIN - FIDUCIAL_SIZE,
                               CARD_H - FIDUCIAL_MARGIN - FIDUCIAL_SIZE))
    # Top-left est occupé par le QR (qui fait office de fiducial principal)
    return fids


# ─── Cuvettes échelle de gris ─────────────────────────────────────────
def build_gray_cuvettes():
    cuvettes = []
    for i in range(4):
        x = GRAY_START_X + i * (GRAY_PATCH_SIZE + GRAY_GAP)
        y = y_top_to_stl(GRAY_START_Y, GRAY_PATCH_SIZE)
        cuvettes.append(box(GRAY_PATCH_SIZE, GRAY_PATCH_SIZE,
                            GRAY_DEPTH + 0.01,
                            x, y, CARD_THICKNESS - GRAY_DEPTH))
    return cuvettes


# ─── Cuvettes fluo avec textures uniques ──────────────────────────────
def build_fluo_cuvette(col):
    x = FLUO_START_X + col * (FLUO_PATCH_SIZE + FLUO_GAP)
    y = y_top_to_stl(FLUO_START_Y, FLUO_PATCH_SIZE)
    return box(FLUO_PATCH_SIZE, FLUO_PATCH_SIZE, FLUO_DEPTH + 0.01,
               x, y, CARD_THICKNESS - FLUO_DEPTH), x, y


def build_texture_horizontal_ridges(x, y, depth):
    """Texture A : rainures horizontales 0.4 mm de large, pas 0.8 mm."""
    ridges = []
    z_fond = CARD_THICKNESS - depth
    for i in np.arange(2, FLUO_PATCH_SIZE - 1, 0.8):
        b = box(FLUO_PATCH_SIZE - 4, 0.4, TEXTURE_HEIGHT,
                x + 2, y + i, z_fond)
        ridges.append(b)
    return ridges


def build_texture_vertical_ridges(x, y, depth):
    """Texture B : rainures verticales 0.4 mm, pas 0.8 mm."""
    ridges = []
    z_fond = CARD_THICKNESS - depth
    for i in np.arange(2, FLUO_PATCH_SIZE - 1, 0.8):
        b = box(0.4, FLUO_PATCH_SIZE - 4, TEXTURE_HEIGHT,
                x + i, y + 2, z_fond)
        ridges.append(b)
    return ridges


def build_texture_grid(x, y, depth):
    """Texture C : grille croisée 0.4 mm × 0.4 mm, maillage 1.2 mm."""
    ridges = []
    z_fond = CARD_THICKNESS - depth
    for i in np.arange(2, FLUO_PATCH_SIZE - 1, 1.2):
        ridges.append(box(FLUO_PATCH_SIZE - 4, 0.4, TEXTURE_HEIGHT,
                          x + 2, y + i, z_fond))
        ridges.append(box(0.4, FLUO_PATCH_SIZE - 4, TEXTURE_HEIGHT,
                          x + i, y + 2, z_fond))
    return ridges


def build_texture_dots(x, y, depth):
    """Texture D : pointillé carré (signature Lucens — dots arrangés en quinconce)."""
    ridges = []
    z_fond = CARD_THICKNESS - depth
    dot_size = 0.6
    pitch = 1.5
    rows = int((FLUO_PATCH_SIZE - 4) / pitch)
    cols = int((FLUO_PATCH_SIZE - 4) / pitch)
    for ri in range(rows):
        for ci in range(cols):
            cx = x + 2 + ci * pitch
            cy = y + 2 + ri * pitch
            if ri % 2 == 1:
                cx += pitch / 2
            if cx + dot_size > x + FLUO_PATCH_SIZE - 1.5:
                continue
            ridges.append(box(dot_size, dot_size, TEXTURE_HEIGHT,
                              cx, cy, z_fond))
    return ridges


# ─── Mire de résolution spatiale ──────────────────────────────────────
def build_resolution_target():
    """3 zones côte-à-côte : lignes 0.2mm / 0.5mm / 1mm pour calibrer netteté."""
    ridges = []
    zones = [
        (0.2, 0.4),     # zone 1 : pas 0.4mm, lignes 0.2mm
        (0.5, 1.0),     # zone 2 : pas 1.0mm, lignes 0.5mm
        (1.0, 2.0),     # zone 3 : pas 2.0mm, lignes 1.0mm
    ]
    zone_w = RESO_ZONE_W / 3
    y = y_top_to_stl(RESO_START_Y, RESO_ZONE_H)
    for idx, (line_w, pitch) in enumerate(zones):
        zx = RESO_START_X + idx * zone_w
        for i in np.arange(0.5, zone_w - 0.5, pitch):
            ridges.append(box(line_w, RESO_ZONE_H - 1, RESO_LINE_HEIGHT,
                              zx + i, y + 0.5, CARD_THICKNESS))
    return ridges


# ─── Barre d'échelle 10 mm ────────────────────────────────────────────
def build_scale_bar():
    """Barre horizontale 10mm en relief, avec graduations tous les 2mm."""
    parts = []
    y = y_top_to_stl(SCALE_BAR_Y, SCALE_BAR_W)
    # Barre principale
    parts.append(box(SCALE_BAR_LEN, SCALE_BAR_W, SCALE_BAR_HEIGHT,
                     SCALE_BAR_X, y, CARD_THICKNESS))
    # Graduations tous les 2 mm (5 ticks plus hauts)
    for i in range(0, 6):
        tx = SCALE_BAR_X + i * 2.0 - 0.15
        parts.append(box(0.3, SCALE_BAR_W + 0.6, SCALE_BAR_HEIGHT,
                         tx, y - 0.3, CARD_THICKNESS))
    return parts


# ─── Logo "L" Lucens embossé ─────────────────────────────────────────
def build_logo_L():
    """Lettre L en relief, signature Lucens."""
    parts = []
    y_top = LOGO_Y
    L_h = 12.0
    L_w_vertical = 2.0
    L_w_horizontal = 8.0
    L_thick_horiz = 2.5
    # Barre verticale du L
    y_vert = y_top_to_stl(y_top, L_h)
    parts.append(box(L_w_vertical, L_h, LOGO_HEIGHT,
                     LOGO_X, y_vert, CARD_THICKNESS))
    # Barre horizontale du L (en bas)
    y_horiz = y_top_to_stl(y_top + L_h - L_thick_horiz, L_thick_horiz)
    parts.append(box(L_w_horizontal, L_thick_horiz, LOGO_HEIGHT,
                     LOGO_X, y_horiz, CARD_THICKNESS))
    return parts


# ─── Cadre zone code série (vide, à graver/peindre) ──────────────────
def build_serial_frame():
    """Cadre vide en relief pour identifier la zone du code série."""
    parts = []
    y = y_top_to_stl(SERIAL_ZONE_Y, SERIAL_ZONE_H)
    frame_thick = 0.4
    # 4 côtés du cadre
    parts.append(box(SERIAL_ZONE_W, frame_thick, SERIAL_FRAME_HEIGHT,
                     SERIAL_ZONE_X, y, CARD_THICKNESS))
    parts.append(box(SERIAL_ZONE_W, frame_thick, SERIAL_FRAME_HEIGHT,
                     SERIAL_ZONE_X, y + SERIAL_ZONE_H - frame_thick,
                     CARD_THICKNESS))
    parts.append(box(frame_thick, SERIAL_ZONE_H, SERIAL_FRAME_HEIGHT,
                     SERIAL_ZONE_X, y, CARD_THICKNESS))
    parts.append(box(frame_thick, SERIAL_ZONE_H, SERIAL_FRAME_HEIGHT,
                     SERIAL_ZONE_X + SERIAL_ZONE_W - frame_thick, y,
                     CARD_THICKNESS))
    return parts


# ─── Construction mesh complet ────────────────────────────────────────
def build_card_mesh():
    print(f"Génération QR pour: {QR_TEXT}")
    matrix = generate_qr_matrix(QR_TEXT)
    print(f"  QR version: {len(matrix)}x{len(matrix)} modules")

    # Base
    base = box(CARD_W, CARD_H, CARD_THICKNESS, 0, 0, 0)

    # Cuvettes (échelle gris + fluo)
    cuvettes = build_gray_cuvettes()
    print(f"  {len(cuvettes)} cuvettes échelle de gris")

    fluo_meta = []
    for col in range(4):
        cuv, fx, fy = build_fluo_cuvette(col)
        cuvettes.append(cuv)
        fluo_meta.append((fx, fy))
    print(f"  {len(fluo_meta)} cuvettes fluo (4 textures uniques)")

    # Soustraction des cuvettes de la base
    print("  Boolean base − cuvettes…")
    union_cuvettes = trimesh.util.concatenate(cuvettes)
    card = base.difference(union_cuvettes, engine='manifold')

    # Ajout des textures uniques au fond des cuvettes fluo
    print("  Ajout textures fluo uniques (4 patterns différents)…")
    texture_builders = [
        build_texture_horizontal_ridges,
        build_texture_vertical_ridges,
        build_texture_grid,
        build_texture_dots,
    ]
    all_textures = []
    for (fx, fy), builder in zip(fluo_meta, texture_builders):
        all_textures.extend(builder(fx, fy, FLUO_DEPTH))
    print(f"  {len(all_textures)} éléments de texture")

    # QR modules en relief
    qr_boxes = build_qr_modules()
    print(f"  {len(qr_boxes)} modules QR en relief")

    # Marqueurs fiducials
    fiducials = build_all_fiducials()
    print(f"  {len(fiducials)} marqueurs fiducials aux coins")

    # Mire de résolution
    reso = build_resolution_target()
    print(f"  {len(reso)} lignes mire de résolution")

    # Barre d'échelle
    scale = build_scale_bar()
    print(f"  {len(scale)} éléments barre d'échelle 10mm")

    # Logo L Lucens
    logo = build_logo_L()
    print(f"  {len(logo)} éléments logo L Lucens")

    # Cadre code série retiré (V3.1) — carte standard identique pour tous,
    # pas de traçabilité individuelle (évite la complexité base de données)

    # Assemblage final
    all_reliefs = all_textures + qr_boxes + fiducials + reso + scale + logo
    print(f"  Concat final ({len(all_reliefs)} reliefs)…")
    card = trimesh.util.concatenate([card] + all_reliefs)

    return card


# ─── OpenSCAD source pour édition paramétrique ────────────────────────
def build_openscad_source():
    """Version OpenSCAD allégée — pour modifier les paramètres facilement."""
    matrix = generate_qr_matrix(QR_TEXT)
    n = len(matrix)
    matrix_lines = []
    for row in matrix:
        matrix_lines.append('  [' + ', '.join('1' if c else '0' for c in row) + ']')
    matrix_str = ',\n'.join(matrix_lines)

    return f"""// =============================================================
// CARTE DE CALIBRATION LUCENS V3 — UNIQUE Lucens
// Contenu QR : {QR_TEXT}
// Format : {CARD_W} × {CARD_H} × {CARD_THICKNESS} mm
// =============================================================
// Cette carte est conçue spécifiquement pour calibrer toute la
// chaîne Lucens IA. Elle inclut :
//   - QR Lucens central (auth + fiducial)
//   - 4 fiducials aux coins (rectification perspective)
//   - 4 cuvettes échelle de gris (calibre gamma)
//   - 4 cuvettes fluo avec textures uniques (calibre signatures fluo + résolution)
//   - Mire de résolution spatiale (3 fréquences)
//   - Barre d'échelle 10 mm calibrée
//   - Logo L Lucens embossé
//   - Cadre code série individuel (traçabilité métrologique)
//
// Pour modifier la géométrie : changer les paramètres ci-dessous puis
// File → Export → STL.
// =============================================================

card_w = {CARD_W};
card_h = {CARD_H};
card_thickness = {CARD_THICKNESS};

qr_size = {QR_SIZE};
qr_height = {QR_HEIGHT};
qr_cx = {QR_CENTER_X};
qr_cy = {QR_CENTER_Y};

fiducial_size = {FIDUCIAL_SIZE};
fiducial_height = {FIDUCIAL_HEIGHT};
fiducial_margin = {FIDUCIAL_MARGIN};

gray_size = {GRAY_PATCH_SIZE};
gray_depth = {GRAY_DEPTH};
fluo_size = {FLUO_PATCH_SIZE};
fluo_depth = {FLUO_DEPTH};
texture_h = {TEXTURE_HEIGHT};

// Matrice QR (générée pour "{QR_TEXT}")
qr_matrix = [
{matrix_str}
];
qr_n = {n};
qr_module = qr_size / qr_n;

// Voir le script Python pour générer le mesh complet :
//   python scripts/generate_carte_lucens_3d.py
//
// Ce fichier OpenSCAD ne contient QUE les paramètres pour référence.
// La géométrie complète (textures, mire, logo, etc.) est trop complexe
// à reproduire en OpenSCAD pur — utilisez le STL généré par Python.
"""


def main():
    out_dir = Path(__file__).resolve().parent.parent / 'docs' / 'carte-lucens-3d'
    out_dir.mkdir(parents=True, exist_ok=True)

    # OpenSCAD source paramétrique
    scad_path = out_dir / 'carte-lucens-v3.scad'
    scad_path.write_text(build_openscad_source(), encoding='utf-8')
    print(f"[OK] OpenSCAD écrit : {scad_path}")

    # STL ready-to-slice
    print("Construction mesh STL...")
    card = build_card_mesh()
    stl_path = out_dir / 'carte-lucens-v3.stl'
    card.export(str(stl_path))
    print(f"[OK] STL écrit : {stl_path}")
    print(f"     Volume: {card.volume:.1f} mm3 · Triangles: {len(card.faces)}")

    # Copie à la racine pour serving Vercel
    root_dir = Path(__file__).resolve().parent.parent
    import shutil
    shutil.copy(str(stl_path), str(root_dir / 'carte-lucens-v3.stl'))
    shutil.copy(str(scad_path), str(root_dir / 'carte-lucens-v3.scad'))
    print(f"[OK] Copie à la racine pour déploiement Vercel")


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""
Genere un STL de carte de calibration TEXTURE pour Lucens.
Carte 110 x 76 mm, 6 zones de texture croissante en relief.
A imprimer (Creality K2) puis peindre avec peinture UV fluorescente.
"""
import struct, math

# ---- Parametres carte ----
CARD_W = 110.0      # largeur mm
CARD_H = 76.0       # hauteur mm
BASE_T = 2.0        # epaisseur de base mm
RES    = 0.35       # resolution grille mm

# Zones : grille 3 colonnes x 2 lignes
MARGIN = 4.0
ZONE   = 32.0
GAPX   = 5.0
GAPY   = 5.0
col_x = [MARGIN, MARGIN + ZONE + GAPX, MARGIN + 2*(ZONE + GAPX)]
row_y = [MARGIN, MARGIN + ZONE + GAPY]

def zone_of(x, y):
    """Retourne (idx, lx, ly) si (x,y) dans une zone, sinon None."""
    for ci, zx in enumerate(col_x):
        if zx <= x <= zx + ZONE:
            for ri, zy in enumerate(row_y):
                if zy <= y <= zy + ZONE:
                    return (ri * 3 + ci, x - zx, y - zy)
    return None

def tex_height(x, y):
    """Hauteur de texture (mm) au point (x,y). 0 hors zone."""
    z = zone_of(x, y)
    if z is None:
        return 0.0
    idx, lx, ly = z
    if idx == 0:
        # LISSE — plat
        return 0.0
    if idx == 1:
        # GRAIN FIN — bosses periode 2.0mm, ampl 0.35mm
        p = 2.0; a = 0.35
        return a * (0.5+0.5*math.cos(2*math.pi*lx/p)) * (0.5+0.5*math.cos(2*math.pi*ly/p))
    if idx == 2:
        # STRIES — sillons 1D periode 2.6mm, ampl 0.55mm
        p = 2.6; a = 0.55
        return a * (0.5+0.5*math.cos(2*math.pi*lx/p))
    if idx == 3:
        # GRAIN MOYEN — bosses periode 4.5mm, ampl 0.8mm
        p = 4.5; a = 0.8
        return a * (0.5+0.5*math.cos(2*math.pi*lx/p)) * (0.5+0.5*math.cos(2*math.pi*ly/p))
    if idx == 4:
        # GROSSIER — gros amas periode 8mm, ampl 1.5mm
        p = 8.0; a = 1.5
        return a * (0.5+0.5*math.cos(2*math.pi*lx/p)) * (0.5+0.5*math.cos(2*math.pi*ly/p))
    if idx == 5:
        # MIXTE — bosses moyennes + stries croisees
        h1 = 0.55 * (0.5+0.5*math.cos(2*math.pi*lx/5.0)) * (0.5+0.5*math.cos(2*math.pi*ly/5.0))
        h2 = 0.35 * (0.5+0.5*math.cos(2*math.pi*(lx+ly)/3.0))
        return h1 + h2
    return 0.0

# ---- Grille ----
NX = int(CARD_W / RES) + 1
NY = int(CARD_H / RES) + 1
print("Grille %dx%d points" % (NX, NY))

# Hauteur Z de la surface superieure pour chaque point
def gx(i): return i * CARD_W / (NX - 1)
def gy(j): return j * CARD_H / (NY - 1)

top = [[0.0]*NY for _ in range(NX)]
for i in range(NX):
    x = gx(i)
    for j in range(NY):
        y = gy(j)
        top[i][j] = BASE_T + tex_height(x, y)

# ---- Construction des triangles ----
tris = []  # chaque tri = (v1, v2, v3) tuples (x,y,z)

def add_quad(a, b, c, d):
    """Quad a-b-c-d (CCW) -> 2 triangles."""
    tris.append((a, b, c))
    tris.append((a, c, d))

# Surface superieure (heightmap)
for i in range(NX-1):
    for j in range(NY-1):
        x0, x1 = gx(i), gx(i+1)
        y0, y1 = gy(j), gy(j+1)
        v00 = (x0, y0, top[i][j])
        v10 = (x1, y0, top[i+1][j])
        v11 = (x1, y1, top[i+1][j+1])
        v01 = (x0, y1, top[i][j+1])
        add_quad(v00, v10, v11, v01)

# Surface inferieure (plate z=0) — orientation inversee
for i in range(NX-1):
    for j in range(NY-1):
        x0, x1 = gx(i), gx(i+1)
        y0, y1 = gy(j), gy(j+1)
        v00 = (x0, y0, 0.0)
        v10 = (x1, y0, 0.0)
        v11 = (x1, y1, 0.0)
        v01 = (x0, y1, 0.0)
        add_quad(v00, v01, v11, v10)

# Murs lateraux
# bord y=0 et y=CARD_H
for i in range(NX-1):
    x0, x1 = gx(i), gx(i+1)
    # y=0
    add_quad((x0,0,0),(x1,0,0),(x1,0,top[i+1][0]),(x0,0,top[i][0]))
    # y=max
    jm = NY-1
    add_quad((x1,CARD_H,0),(x0,CARD_H,0),(x0,CARD_H,top[i][jm]),(x1,CARD_H,top[i+1][jm]))

# bord x=0 et x=CARD_W
for j in range(NY-1):
    y0, y1 = gy(j), gy(j+1)
    add_quad((0,y1,0),(0,y0,0),(0,y0,top[0][j]),(0,y1,top[0][j+1]))
    im = NX-1
    add_quad((CARD_W,y0,0),(CARD_W,y1,0),(CARD_W,y1,top[im][j+1]),(CARD_W,y0,top[im][j]))

print("Triangles : %d" % len(tris))

# ---- Calcul normale + ecriture STL binaire ----
def normal(v1, v2, v3):
    ux, uy, uz = v2[0]-v1[0], v2[1]-v1[1], v2[2]-v1[2]
    vx, vy, vz = v3[0]-v1[0], v3[1]-v1[1], v3[2]-v1[2]
    nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
    L = math.sqrt(nx*nx+ny*ny+nz*nz) or 1.0
    return (nx/L, ny/L, nz/L)

out = r"C:\Users\Lamiralx\Downloads\Lucens_carte_texture.stl"
with open(out, "wb") as f:
    f.write(b"Lucens texture calibration card" + b" "*49)  # header 80
    f.write(struct.pack("<I", len(tris)))
    for (v1, v2, v3) in tris:
        nx, ny, nz = normal(v1, v2, v3)
        f.write(struct.pack("<fff", nx, ny, nz))
        for v in (v1, v2, v3):
            f.write(struct.pack("<fff", v[0], v[1], v[2]))
        f.write(struct.pack("<H", 0))

import os
print("STL ecrit : %s (%.1f Mo)" % (out, os.path.getsize(out)/1048576))

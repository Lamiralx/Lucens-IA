// ============================================================
// CARTE DE CALIBRATION LUCENS V2 — modèle 3D paramétrique
// Contenu QR : LUCENS:CALIBV2
// Format final : 150.0 × 100.0 × 2.5 mm
// Compatible Creality K2 / Bambu / Prusa
// ============================================================

// ─── PARAMÈTRES (modifiables) ──────────────────────────────
card_w = 150.0;
card_h = 100.0;
card_thickness = 2.5;

qr_size = 22.0;
qr_height = 0.4;
qr_cx = 16.0;         // centre QR depuis coin HAUT-gauche
qr_cy = 16.0;

patch_size = 30.0;
patch_gap = 5.0;
patch_area_x = 40.0;
patch_area_y = 15.0;

cuvette_depth_fluo = 0.6;
cuvette_depth_black = 1.0;

texture_ridge_h = 0.18;
texture_ridge_w = 0.8;
texture_ridge_sp = 1.6;

// ─── MATRICE QR (générée pour "LUCENS:CALIBV2", correction H) ────
qr_matrix = [
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1],
  [1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 1],
  [0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1],
  [0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 1],
  [1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0],
  [1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0],
  [1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1]
];
qr_n = 25;
qr_module = qr_size / qr_n;

// ─── 6 PATCHS : [label, role, col, row] ────────────────────
// role : "white" = pas de cuvette · "fluo" = cuvette + texture · "black" = cuvette profonde
patches = [
  ["Blanc", "white", 0, 0],
  ["Fluo",  "fluo",  1, 0],
  ["Fluo",  "fluo",  2, 0],
  ["Fluo",  "fluo",  0, 1],
  ["Fluo",  "fluo",  1, 1],
  ["Noir",  "black", 2, 1],
];

// ─── MODULES ───────────────────────────────────────────────
module card_base() {
  cube([card_w, card_h, card_thickness]);
}

function patch_pos(col, row) = [
  patch_area_x + col * (patch_size + patch_gap),
  card_h - patch_area_y - (row + 1) * patch_size - row * patch_gap
];

module cuvette(col, row, depth) {
  pos = patch_pos(col, row);
  translate([pos[0], pos[1], card_thickness - depth + 0.001])
    cube([patch_size, patch_size, depth + 0.01]);
}

module texture_ridges(col, row, depth) {
  pos = patch_pos(col, row);
  cx = pos[0] + patch_size / 2;
  cy = pos[1] + patch_size / 2;
  z_fond = card_thickness - depth;
  diag = patch_size * 1.5;
  intersection() {
    translate([cx, cy, z_fond + texture_ridge_h / 2])
      rotate([0, 0, 45])
        union() {
          for (i = [-15:15]) {
            translate([0, i * texture_ridge_sp, 0])
              cube([diag, texture_ridge_w, texture_ridge_h], center=true);
          }
        }
    translate([pos[0], pos[1], z_fond])
      cube([patch_size, patch_size, texture_ridge_h * 2]);
  }
}

module qr_modules() {
  qr_origin_x = qr_cx - qr_size / 2;
  qr_origin_y_top = qr_cy - qr_size / 2;
  qr_origin_y = card_h - qr_origin_y_top - qr_size;
  translate([qr_origin_x, qr_origin_y, card_thickness])
    for (row = [0 : qr_n - 1]) {
      for (col = [0 : qr_n - 1]) {
        if (qr_matrix[row][col] == 1) {
          translate([col * qr_module, (qr_n - 1 - row) * qr_module, 0])
            cube([qr_module, qr_module, qr_height]);
        }
      }
    }
}

// ─── ASSEMBLAGE ────────────────────────────────────────────
union() {
  difference() {
    card_base();
    // Cuvettes pour patchs fluo et noir
    for (p = patches) {
      if (p[1] == "fluo") cuvette(p[2], p[3], cuvette_depth_fluo);
      else if (p[1] == "black") cuvette(p[2], p[3], cuvette_depth_black);
    }
  }
  // Textures diagonales au fond des cuvettes fluo (aide accroche peinture)
  for (p = patches) {
    if (p[1] == "fluo") texture_ridges(p[2], p[3], cuvette_depth_fluo);
  }
  // Modules QR en relief
  qr_modules();
}

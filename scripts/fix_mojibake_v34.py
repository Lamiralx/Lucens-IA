# -*- coding: utf-8 -*-
"""
V34 — Sanitation finale des mojibakes restants dans index.html.

Operation byte-level pour eviter toute corruption supplementaire :
chaque sequence corrompue identifiee est remplacee par les bons bytes UTF-8.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

# Table des remplacements (hex bytes corrompus -> hex bytes propres)
# Chaque entree : (description, bytes_corrupted_hex, bytes_clean_hex)
REPLACEMENTS = [
    # Fleches doubles ou simples
    ('right_arrow',     'c3a2e280a0e28099', 'e28692'),  # â†' -> →
    ('down_arrow',      'c3a2e280a0e2809c', 'e28693'),  # â†" -> ↓
    ('left_arrow',      'c3a2e280a0e28098', 'e28690'),  # â†‘ -> ←
    ('up_arrow_via',    'c3a2e280a0c692',   'e28691'),  # â†' -> ↑
    ('double_right',    'c3a2e280a1e28099', 'e28792'),  # â‡' -> ⇒
    ('arrow_back_curve','c3a2e280a0c2b6',   'e286b6'),  # â†¶ -> ↶
    ('arrow_loop_right','c3a2c2a4c2b3',     'e2a4b3'),  # â¤³ -> ⤳

    # Symboles math
    ('greater_equal',   'c3a2e280b0c2a5',   'e289a5'),  # â‰¥ -> ≥
    ('less_equal',      'c3a2e280b0c2a4',   'e289a4'),  # â‰¤ -> ≤

    # Box drawing (cosmetique commentaires)
    ('box_horiz',       'c3a2e2809de282ac', 'e29480'),  # â"€ -> ─

    # Symboles divers
    ('lightning',       'c3a2c5a1c2a1',     'e29aa1'),  # âš¡ -> ⚡

    # Majuscules accentuees (i18n)
    ('A_circumflex',    'c383e2809a',       'c382'),    # Ã‚ -> Â
    ('A_tilde',         'c383c2a3',         'c383'),    # Ã£ -> Ã
    ('E_acute',         'c383e280b0',       'c389'),    # Ã‰ -> É (fix only if needed)
    ('I_circumflex',    'c383c5be',         'c38e'),    # ÃŽ -> Î (fix only if needed)
    ('O_diaeresis',     'c383e28093',       'c396'),    # Ã– -> Ö
    ('O_acute',         'c383e2809c',       'c393'),    # Ã" -> Ó
    ('O_circumflex',    'c383e2809d',       'c394'),    # Ã" -> Ô
    ('O_tilde',         'c383e280a2',       'c395'),    # Ã• -> Õ
    ('U_grave',         'c383e284a2',       'c399'),    # Ã™ -> Ù
    ('U_circumflex',    'c383c2bb',         'c39b'),    # Ã› -> Û
    ('OE_lig_capital',  'c385e28099',       'c592'),    # Å' -> Œ
]

content = HTML.read_bytes()
original_size = len(content)
print(f"Taille initiale : {original_size:,} bytes")

total_fixes = 0
for name, corrupt_hex, clean_hex in REPLACEMENTS:
    corrupt = bytes.fromhex(corrupt_hex)
    clean = bytes.fromhex(clean_hex)
    count = content.count(corrupt)
    if count > 0:
        content = content.replace(corrupt, clean)
        total_fixes += count
        print(f"  {name:22s} : {count:5d} replacements ({corrupt_hex} -> {clean_hex})")

print(f"\nTotal corrections : {total_fixes}")
print(f"Taille finale : {len(content):,} bytes (delta : {len(content) - original_size:+d})")

if total_fixes > 0:
    backup = HTML.with_suffix('.html.bak_v34')
    backup.write_bytes(HTML.read_bytes())  # snapshot before write
    HTML.write_bytes(content)
    print(f"\nBackup : {backup.name}")
    print(f"OK index.html mis a jour")
else:
    print("\nAucun changement applique")

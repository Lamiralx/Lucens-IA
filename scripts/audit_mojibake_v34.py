# -*- coding: utf-8 -*-
"""
Audit V34 — Inventaire complet des mojibakes restants dans index.html
Identifie les corruptions visibles par l'utilisateur vs uniquement dans commentaires.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

if not HTML.exists():
    print("ERREUR : index.html introuvable")
    sys.exit(1)

content = HTML.read_text(encoding='utf-8')

# Patterns mojibake critiques — table de réparation cible
PATTERNS = {
    'arrow_right_horizontal':   ('â†’', '→'),
    'arrow_down_short':         ('â†"', '↓'),
    'arrow_up_short':           ('â†', '↑'),
    'arrow_left_short':         ('â†', '←'),
    'arrow_double_right':       ('â‡', '⇒'),
    'box_drawing_horizontal':   ('â”€', '─'),
    'lightning_bolt':           ('âš¡', '⚡'),
    'check_mark':               ('âœ"', '✓'),
    'cross_mark':               ('âœ—', '✗'),
    'O_diaeresis_capital':      ('Ã–', 'Ö'),
    'O_acute_capital':          ('Ã"', 'Ó'),
    'O_acute_capital_alt':      ('Ã"', 'Ó'),  # alt UTF-8
    'e_acute':                  ('Ã©', 'é'),
    'e_grave':                  ('Ã¨', 'è'),
    'a_grave':                  ('Ã ', 'à'),
    'c_cedilla':                ('Ã§', 'ç'),
    'apostrophe_smart':         ('â€™', "'"),
    'ellipsis':                 ('â€¦', '…'),
    'em_dash':                  ('â€"', '—'),
    'en_dash':                  ('â€"', '–'),
    'greater_equal':            ('â‰¥', '≥'),
    'less_equal':               ('â‰¤', '≤'),
    'tilde_a_lower':            ('Ã£', 'ã'),
    'A_circumflex':             ('Ã‚', 'Â'),
    'multiply_sign_mojibake':   ('Ã—', '×'),
}

# Catégoriser les occurrences selon contexte
lines = content.split('\n')

stats = {}
critical_examples = {}

for name, (corrupt, fix) in PATTERNS.items():
    count = 0
    critical = []  # lignes hors commentaire
    for i, line in enumerate(lines):
        if corrupt in line:
            count += line.count(corrupt)
            # Détection contexte : commentaire CSS, JS ou code actif
            stripped = line.strip()
            is_comment = (
                stripped.startswith('/*') or
                stripped.startswith('*') or
                stripped.startswith('//') or
                '/*' in line[:line.find(corrupt)]
            )
            if not is_comment and len(critical) < 3:
                critical.append((i+1, line.strip()[:120]))
    if count > 0:
        stats[name] = count
        if critical:
            critical_examples[name] = critical

# Rapport
print('=' * 70)
print('AUDIT V34 — MOJIBAKES INDEX.HTML')
print('=' * 70)
print()
print(f"Total mojibakes par catégorie :")
print()
for name, n in sorted(stats.items(), key=lambda x: -x[1]):
    print(f"  {name:35s} {n:6d} occurrences")
print()
print('=' * 70)
print('EXEMPLES CRITIQUES (code actif, hors commentaire) :')
print('=' * 70)
for name, examples in critical_examples.items():
    print(f"\n[{name}]")
    for line_no, snippet in examples:
        print(f"  L{line_no}: {snippet}")

total = sum(stats.values())
print()
print(f"TOTAL CORRUPTIONS COMPTÉES : {total}")

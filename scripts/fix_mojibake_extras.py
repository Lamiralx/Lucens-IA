"""Deuxième passe pour les motifs hors cp1252 (grec, emojis, exposants)."""
import sys
from pathlib import Path

# Patterns de remplacement direct identifiés après diff
REPLACEMENTS = {
    # Math/grec
    'Ï': 'ρ',           # rho — utilisé en géométrie
    'Î¸': 'θ',           # theta
    'MnÂ²âº': 'Mn²⁺',    # manganèse 2+
    # Emojis populaires
    'â­': '⭐',
    'ðŸ…': '🅰',
    'ðŸ…°': '🅰',
    'ðŸŽ–': '🎖',
    'ï¸': '️',      # variation selector emoji
    # Box drawing
    'â•': '═',
    'â•â•â•': '═══',
}

def main():
    root = Path(__file__).resolve().parent.parent
    path = root / 'index.html'
    text = path.read_text(encoding='utf-8')
    before_len = len(text)
    n_total = 0
    for old, new in REPLACEMENTS.items():
        n = text.count(old)
        if n > 0:
            text = text.replace(old, new)
            n_total += n
            print(f'  {n}x  {repr(old)} -> {repr(new)}')
    if n_total > 0:
        path.write_text(text, encoding='utf-8', newline='')
        print(f'OK : {n_total} remplacements supplementaires')
    else:
        print('Rien a remplacer')

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

"""
Réparation du double-encodage UTF-8 (mojibake) dans les fichiers source
Lucens IA après corruption causée par PowerShell Set-Content -Encoding utf8.

Mode CHIRURGICAL ligne par ligne : on tente le round-trip cp1252 → utf8
SUR CHAQUE LIGNE indépendamment, et on garde la version corrigée seulement
si elle réduit le nombre de marqueurs mojibake ET ne casse rien.

Sécurité :
  - Sauvegarde .mojibake-backup avant toute modif
  - Skip silencieux des lignes qui ne contiennent pas de mojibake
  - Skip des lignes où la conversion échoue ou n'améliore pas
"""
import sys
from pathlib import Path

# Motifs mojibake typiques en français (présence = corruption détectée)
MOJIBAKE_MARKERS = [
    'Ã©', 'Ã¨', 'Ã ', 'Ã´', 'Ã®', 'Ã§', 'Ã¯', 'Ã»', 'Ã¢',
    'Ã‰', 'ÃŠ', 'ÃŽ', 'Ã‚', 'Ã™', 'Ã€',
    'â€™', 'â€"', 'â€¦', 'â€œ', 'â€\x9d', 'â€¢',
    'Â°', 'Â«', 'Â»', 'Â ',
]

def count_mojibake(text: str) -> int:
    return sum(text.count(m) for m in MOJIBAKE_MARKERS)

def fix_line(line: str) -> str | None:
    """Tente cp1252 round-trip sur une ligne. Retourne la version corrigée
    ou None si pas applicable / pas d'amélioration."""
    if count_mojibake(line) == 0:
        return None
    try:
        candidate = line.encode('cp1252', errors='strict').decode('utf-8', errors='strict')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    if count_mojibake(candidate) < count_mojibake(line):
        return candidate
    return None

def fix_file(path: Path) -> tuple[int, int]:
    """Retourne (nb_lignes_corrigées, nb_mojibake_restants)."""
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        return -1, -1

    lines = text.split('\n')
    fixed_count = 0
    fixed_lines = []
    for line in lines:
        new_line = fix_line(line)
        if new_line is not None:
            fixed_lines.append(new_line)
            fixed_count += 1
        else:
            fixed_lines.append(line)

    if fixed_count == 0:
        remaining = count_mojibake(text)
        return 0, remaining

    new_text = '\n'.join(fixed_lines)
    backup = path.with_suffix(path.suffix + '.mojibake-backup')
    backup.write_bytes(text.encode('utf-8'))
    path.write_text(new_text, encoding='utf-8', newline='')
    remaining = count_mojibake(new_text)
    return fixed_count, remaining

def main():
    targets = sys.argv[1:] or [
        'index.html',
        'api/analyze.js',
        'api/validate-cluster.js',
        'api/_lib/spectro.js',
    ]
    root = Path(__file__).resolve().parent.parent
    for rel in targets:
        path = root / rel
        if not path.exists():
            print(f'-- {rel}: introuvable')
            continue
        fixed, remaining = fix_file(path)
        if fixed < 0:
            print(f'X  {rel}: pas UTF-8 valide')
        elif fixed == 0 and remaining == 0:
            print(f'.  {rel}: OK (rien a faire)')
        elif fixed == 0 and remaining > 0:
            print(f'!  {rel}: {remaining} mojibake DETECTES mais aucune ligne reparable')
        else:
            print(f'+  {rel}: {fixed} lignes corrigees, {remaining} mojibake restants')

if __name__ == '__main__':
    main()

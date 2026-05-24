"""
Réparation exhaustive du mojibake UTF-8 dans index.html.
Table de mapping directe couvrant FR/ES/DE/EN + ponctuation typographique.
"""
import sys
from pathlib import Path

# Table complète : pattern mojibake → caractère propre
# Ordre important : remplacer les motifs longs (â€¦, â€™…) AVANT les courts (Ã*, Â*)
REPLACEMENTS = [
    # Ponctuation typographique Unicode (E2 80 xx mangled)
    ('â€¦', '…'),
    ('â€™', '’'),       # apostrophe typographique
    ('â€˜', '‘'),
    ('â€œ', '“'),
    ('â€\x9d', '”'),
    ('â€ž', '„'),
    ('â€¢', '•'),
    ('â€¹', '‹'),
    ('â€º', '›'),
    ('â€"', '—'),           # em dash
    ('â€"', '–'),            # en dash (parfois confondu)

    # Caractères latins majuscules (C3 8x mangled)
    ('Ã€', 'À'), ('Ã\x81', 'Á'), ('Ã\x82', 'Â'), ('Ã\x83', 'Ã'),
    ('Ã„', 'Ä'), ('Ã\x85', 'Å'), ('Ã†', 'Æ'), ('Ã‡', 'Ç'),
    ('Ãˆ', 'È'), ('Ã‰', 'É'), ('ÃŠ', 'Ê'), ('Ã‹', 'Ë'),
    ('ÃŒ', 'Ì'), ('Ã\x8d', 'Í'), ('ÃŽ', 'Î'), ('Ã\x8f', 'Ï'),
    ('Ã\x90', 'Ð'), ('Ã\x91', 'Ñ'), ('Ã\x92', 'Ò'), ('Ã\x93', 'Ó'),
    ('Ã"', 'Ô'),  ('Ã\x95', 'Õ'), ('Ã\x96', 'Ö'), ('Ã—', '×'),
    ('Ã˜', 'Ø'), ('Ã\x99', 'Ù'), ('Ãš', 'Ú'), ('Ã›', 'Û'),
    ('Ãœ', 'Ü'), ('Ã\x9d', 'Ý'), ('Ãž', 'Þ'), ('ÃŸ', 'ß'),
    ('Ã"', 'Ó'), ('Ã"', 'Ô'), ('Ã"', 'Ö'),  # variantes avec smart quotes

    # Caractères latins minuscules (C3 9x/Ax/Bx mangled)
    ('Ã\xa0', 'à'), ('Ã¡', 'á'), ('Ã¢', 'â'), ('Ã£', 'ã'),
    ('Ã¤', 'ä'), ('Ã¥', 'å'), ('Ã¦', 'æ'), ('Ã§', 'ç'),
    ('Ã¨', 'è'), ('Ã©', 'é'), ('Ãª', 'ê'), ('Ã«', 'ë'),
    ('Ã¬', 'ì'), ('Ã\xad', 'í'), ('Ã®', 'î'), ('Ã¯', 'ï'),
    ('Ã°', 'ð'), ('Ã±', 'ñ'), ('Ã²', 'ò'), ('Ã³', 'ó'),
    ('Ã´', 'ô'), ('Ãµ', 'õ'), ('Ã¶', 'ö'), ('Ã·', '÷'),
    ('Ã¸', 'ø'), ('Ã¹', 'ù'), ('Ãº', 'ú'), ('Ã»', 'û'),
    ('Ã¼', 'ü'), ('Ã½', 'ý'), ('Ã¾', 'þ'), ('Ã¿', 'ÿ'),

    # Caractères de contrôle (C2 8x-BFx mangled)
    ('Â¡', '¡'), ('Â¢', '¢'), ('Â£', '£'), ('Â¤', '¤'),
    ('Â¥', '¥'), ('Â¦', '¦'), ('Â§', '§'), ('Â¨', '¨'),
    ('Â©', '©'), ('Âª', 'ª'), ('Â«', '«'), ('Â¬', '¬'),
    ('Â®', '®'), ('Â¯', '¯'), ('Â°', '°'), ('Â±', '±'),
    ('Â²', '²'), ('Â³', '³'), ('Â´', '´'), ('Âµ', 'µ'),
    ('Â¶', '¶'), ('Â·', '·'), ('Â¸', '¸'), ('Â¹', '¹'),
    ('Âº', 'º'), ('Â»', '»'), ('Â¼', '¼'), ('Â½', '½'),
    ('Â¾', '¾'), ('Â¿', '¿'),
    ('Â\xa0', '\xa0'),   # NBSP

    # Exposants/indices et symboles math fréquents
    ('âº', '⁺'), ('â»', '⁻'),
]

def main():
    root = Path(__file__).resolve().parent.parent
    path = root / 'index.html'
    text = path.read_text(encoding='utf-8')
    before_size = len(text)
    total = 0
    applied = []
    for old, new in REPLACEMENTS:
        c = text.count(old)
        if c > 0:
            text = text.replace(old, new)
            total += c
            applied.append((c, old, new))

    path.write_text(text, encoding='utf-8', newline='')

    # Tri par fréquence
    applied.sort(reverse=True)
    for c, old, new in applied[:30]:
        print(f'  {c:6d}  {old!r:24s} -> {new!r}')
    print(f'TOTAL : {total} remplacements')

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()

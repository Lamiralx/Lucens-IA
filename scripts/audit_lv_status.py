# -*- coding: utf-8 -*-
"""Trouve tous les setters de lvStatusLabel + setStatus dans Live View."""
from pathlib import Path
content = Path('index.html').read_text(encoding='utf-8')
lines = content.split('\n')

# Cherche les patterns de set status
patterns = ['lvStatusLabel', 'lvStatusBanner', 'setBanner(', 'setLvBanner', 'status.textContent']
for pat in patterns:
    print(f"\n=== '{pat}' ===")
    for i, l in enumerate(lines, 1):
        if pat in l:
            safe = l.strip().encode('ascii', 'backslashreplace').decode('ascii')[:140]
            print(f"  L{i}: {safe}")

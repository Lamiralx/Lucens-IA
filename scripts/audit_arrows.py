# -*- coding: utf-8 -*-
"""Find arrow mojibakes in translations."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"

target_bytes = bytes.fromhex('c3a2e280a0e28099')  # corrupted right arrow

content = HTML.read_bytes()
count = content.count(target_bytes)
print(f"Right-arrow corrupted occurrences: {count}")

lines = content.split(b'\n')
matches = []
for i, line in enumerate(lines, 1):
    if target_bytes in line:
        try:
            decoded = line.decode('utf-8', errors='replace')
            matches.append((i, decoded.strip()[:160]))
        except:
            pass

print(f"Affected lines: {len(matches)}")
for ln, snip in matches[:50]:
    safe = snip.encode('ascii', 'backslashreplace').decode('ascii')
    print(f"  L{ln}: {safe}")

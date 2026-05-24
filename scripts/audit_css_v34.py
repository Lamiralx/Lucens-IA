# -*- coding: utf-8 -*-
"""
Audit V34 — Vérification cohérence variables CSS et IDs HTML.
Croise :
  - var(--xxx) utilisées vs définies dans :root, .lvm, etc.
  - id="xxx" dans HTML vs getElementById / querySelector references en JS
  - Sélecteurs CSS orphelins
"""
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
content = HTML.read_text(encoding='utf-8')

# 1. Variables CSS : utilisées vs définies
defined_vars = set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', content))
used_vars = set(re.findall(r'var\((--[a-zA-Z0-9-]+)', content))

missing = used_vars - defined_vars
unused = defined_vars - used_vars

print('=' * 70)
print('CSS VARIABLES')
print('=' * 70)
print(f"Definies : {len(defined_vars)}")
print(f"Utilisees : {len(used_vars)}")
print(f"\n>>> MANQUANTES ({len(missing)}) — utilisees mais non definies :")
for v in sorted(missing):
    # Trouver une ligne d'exemple
    pat = re.compile(r'var\(' + re.escape(v))
    for i, line in enumerate(content.split('\n'), 1):
        if pat.search(line):
            print(f"   {v:40s} L{i}: {line.strip()[:80]}")
            break

# 2. IDs HTML vs references JS
html_ids = set(re.findall(r'\bid=["\']([a-zA-Z_][a-zA-Z0-9_-]*)["\']', content))
js_refs = set(re.findall(r"getElementById\(['\"]([a-zA-Z_][a-zA-Z0-9_-]*)['\"]\)", content))
# $() helper si défini
dollar_refs = set(re.findall(r"\$\(['\"]([a-zA-Z_][a-zA-Z0-9_-]*)['\"]\)", content))
all_refs = js_refs | dollar_refs

orphan_refs = all_refs - html_ids
unused_ids = html_ids - all_refs

# Filter unused_ids by also checking querySelector/CSS usage
def is_referenced(id_name):
    # Check #id in querySelector or CSS selectors
    pat = re.compile(rf'[#"\']{re.escape(id_name)}[\s"\'),\.]')
    return bool(pat.search(content))

unused_meaningful = [i for i in unused_ids if not is_referenced(i)]

print()
print('=' * 70)
print('HTML IDs')
print('=' * 70)
print(f"IDs definis : {len(html_ids)}")
print(f"Refs JS (getElementById + $) : {len(all_refs)}")
print(f"\n>>> ORPHELINS ({len(orphan_refs)}) — JS reference un ID qui n'existe pas :")
for v in sorted(orphan_refs):
    print(f"   {v}")
print(f"\n>>> NON UTILISES ({len(unused_meaningful)}) — ID HTML jamais utilise :")
for v in sorted(unused_meaningful)[:20]:
    print(f"   {v}")
if len(unused_meaningful) > 20:
    print(f"   ... ({len(unused_meaningful) - 20} de plus)")

# 3. IDs dupliques (le plus grave)
all_ids_with_dups = re.findall(r'\bid=["\']([a-zA-Z_][a-zA-Z0-9_-]*)["\']', content)
# Filter out IDs from JS strings (in comments or strings)
counts = Counter(all_ids_with_dups)
duplicates = {k: v for k, v in counts.items() if v > 1}

# Check if duplicates are real (not in comments / strings)
real_duplicates = {}
for id_name, count in duplicates.items():
    # Find all occurrences and check context
    pat = re.compile(rf'\bid=["\']({re.escape(id_name)})["\']')
    occurrences = []
    for i, line in enumerate(content.split('\n'), 1):
        if pat.search(line):
            stripped = line.strip()
            # Heuristic: comment or string?
            is_comment = stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*')
            in_string = re.search(r'["\'][^"\']*\bid=["\']' + re.escape(id_name), line)
            if not (is_comment or in_string):
                occurrences.append((i, line.strip()[:100]))
    if len(occurrences) > 1:
        real_duplicates[id_name] = occurrences

print()
print('=' * 70)
print(f"\n>>> IDs DUPLIQUES REELS ({len(real_duplicates)}) :")
for id_name, occs in real_duplicates.items():
    print(f"\n   #{id_name}")
    for ln, snip in occs:
        print(f"      L{ln}: {snip}")

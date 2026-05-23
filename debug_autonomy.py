import sys
lines = open('packages/cli/src/execution.ts', 'r', encoding='utf-8').readlines()
# Look for getAutonomy anywhere in the lines content
found = 0
for i, line in enumerate(lines):
    if 'getAutonomy' in line:
        found += 1
        print(f'{i+1}: {repr(line.rstrip())}')
print(f'Total: {found}')
# Also check what the line at 388 looks like (1-indexed = 387 0-indexed)
if len(lines) > 387:
    print(f'Line 388: {repr(lines[387].rstrip())}')

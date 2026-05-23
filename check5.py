with open('packages/cli/src/execution.ts', 'r', encoding='utf-8', newline='') as f:
    lines = f.readlines()
count = 0
for i, line in enumerate(lines):
    stripped = line.rstrip()
    if stripped == 'getAutonomy,':
        count += 1
        print(f'  occurrence {count} at line {i+1}: {repr(stripped)}')
print('Total:', count)

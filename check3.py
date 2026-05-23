with open('packages/cli/src/execution.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
print(len(lines), 'lines total')
count = 0
for i, line in enumerate(lines):
    if line.rstrip() == 'getAutonomy,':
        count += 1
        print(f'  occurrence {count} at line {i+1}: {repr(line)}')
print('Total:', count)

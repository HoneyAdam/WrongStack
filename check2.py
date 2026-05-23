with open('packages/cli/src/execution.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
print(len(lines), 'lines total')
for i in range(385, min(392, len(lines))):
    print(f'  {i+1}: {repr(lines[i])}')

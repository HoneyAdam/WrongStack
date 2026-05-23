lines = open('packages/cli/src/execution.ts', 'r', encoding='utf-8').readlines()
print(len(lines), 'lines total')
for i in range(min(387, len(lines)-1), min(392, len(lines))):
    print(f'  {i+1}: {repr(lines[i])}')

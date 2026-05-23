with open('packages/cli/src/execution.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()
# Line 388 (0-indexed 387) is '        getAutonomy,' - insert '        onAutonomy,' after it
target = '        getAutonomy,'
ins = '        onAutonomy,\n'
for i, line in enumerate(lines):
    if line.rstrip() == target:
        lines.insert(i+1, ins)
        print(f'Inserted at line {i+2}')
        break
else:
    print('NOT FOUND')
    import sys; sys.exit(1)
with open('packages/cli/src/execution.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('Written OK')
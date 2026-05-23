import sys
lines = open('packages/cli/src/execution.ts', 'r', encoding='utf-8').readlines()
count = 0
inserted = False
for i, line in enumerate(lines):
    stripped = line.rstrip()
    if stripped == 'getAutonomy,':
        count += 1
        if count >= 4:
            lines.insert(i+1, '        onAutonomy,\n')
            inserted = True
            print(f'Inserted after occurrence {count} at line {i+1}')
            break
if inserted:
    open('packages/cli/src/execution.ts', 'w', encoding='utf-8').writelines(lines)
else:
    print('NOT FOUND, count was', count)

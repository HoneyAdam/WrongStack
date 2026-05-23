with open('packages/cli/src/execution.ts', 'rb') as f:
    content = f.read()
text = content.decode('utf-8', errors='replace')
lines = text.split('\n')
# Insert after line 388 (index 387)
# Line 388 is '        getAutonomy,'
# Insert '        onAutonomy,' after it
target = '        getAutonomy,'
ins = '        onAutonomy,'
inserted = False
for i, line in enumerate(lines):
    if line.rstrip() == target:
        lines.insert(i+1, ins)
        inserted = True
        print(f'Inserted at line {i+2}')
        break
if inserted:
    with open('packages/cli/src/execution.ts', 'w', newline='') as f:
        f.write('\n'.join(lines))
    print('Written')
else:
    print('NOT FOUND')

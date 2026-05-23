with open('packages/cli/src/execution.ts', 'rb') as f:
    content = f.read()
text = content.decode('utf-8', errors='replace')
lines = text.split('\n')
count = 0
for i, line in enumerate(lines):
    if 'getAutonomy,' in line:
        count += 1
        print(f'  line {i+1}: bytes={repr(line.encode())} str={repr(line.rstrip())}')
print('Total:', count)

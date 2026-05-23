with open('packages/cli/src/execution.ts', 'rb') as f:
    content = f.read()
text = content.decode('utf-8', errors='replace')
lines = text.split('\n')
for i in [134, 271, 364, 387]:
    line = lines[i]
    print(f'Line {i+1}: bytes={repr(line.encode())} rstripped={repr(line.rstrip())} == "getAutonomy,": {line.rstrip() == "getAutonomy,"}')

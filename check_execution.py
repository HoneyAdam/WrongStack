with open('packages/cli/src/execution.ts', 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()
print(f'File size: {len(content)} bytes, {len(content.splitlines())} lines')
# Find runRepl calls
import re
for i, line in enumerate(content.splitlines()):
    if 'runRepl' in line:
        print(f'Line {i+1}: {line}')
# Also look for onAutonomy
for i, line in enumerate(content.splitlines()):
    if 'onAutonomy' in line:
        print(f'Line {i+1}: {line}')
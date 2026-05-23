with open('packages/cli/src/execution.ts', 'rb') as f:
    content = f.read()
# Check line ending style
first_newline = content.find(b'\n')
if first_newline > 0:
    before = content[:first_newline]
    print(f'Line ending before first newline: {repr(before)}')
    print(f'Has CRLF: {content.startswith(b"\r\n")}')
# The key question: does split('\n') give proper results?
text = content.decode('utf-8', errors='replace')
lines = text.split('\n')
print(f'Total lines: {len(lines)}')
# Check around line 388
for i in range(385, min(393, len(lines))):
    print(f'  {i+1}: {repr(lines[i])}')

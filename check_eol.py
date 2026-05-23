with open('packages/cli/src/execution.ts', 'rb') as f:
    d = f.read()
crlf = b'\r\n' in d
lf_only = b'\n' in d and b'\r\n' not in d
print('CRLF:', crlf, 'LF-only:', lf_only)
print('First newline pos:', d.find(b'\n'))

with open('packages/cli/src/execution.ts', 'rb') as f:
    content = f.read()
print('Has CRLF:', b'\r\n' in content)
print('First 200 bytes:', repr(content[:200]))

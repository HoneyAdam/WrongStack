$ErrorActionPreference = 'SilentlyContinue'
$libPath = 'D:\Codebox\PROJECTS\WrongStack\packages\webui\tests\lib'
Get-ChildItem $libPath -Filter '*.test.ts' | Remove-Item -Force
Write-Host 'Deleted test files'
Get-ChildItem $libPath
$content = [System.IO.File]::ReadAllText('D:\Codebox\PROJECTS\WrongStack\test_output.txt')
$lines = $content.Split([Environment]::NewLine)
Write-Host "Lines: $($lines.Count)"
for ($i = [Math]::Max(0, $lines.Count - 50); $i -lt $lines.Count; $i++) {
    Write-Host "$i : $($lines[$i])"
}
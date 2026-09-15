$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$atlasPython = $null
foreach ($atlasCandidate in @('python', 'py')) {
    $atlasCommand = Get-Command $atlasCandidate -ErrorAction SilentlyContinue
    if ($atlasCommand) { $atlasPython = $atlasCommand.Source; break }
}
if (-not $atlasPython) {
    $atlasBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $atlasBundled) { $atlasPython = $atlasBundled }
}
if (-not $atlasPython) { throw 'Install Python 3.11 or newer, then run start.bat again.' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    & $atlasPython -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python virtual environment.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and run setup.ps1 again.' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
Write-Host 'Setup complete. Double-click start.bat to launch Drawing Atlas.'

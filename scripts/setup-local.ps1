param([string]$Python = '')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Run-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Perintah gagal: $Executable (exit $LASTEXITCODE)" }
}
if (-not $Python) {
    $taskCandidates = @('python', (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'))
    foreach ($taskCandidate in $taskCandidates) {
        if (Get-Command $taskCandidate -ErrorAction SilentlyContinue) {
            $taskVersion = & $taskCandidate -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
            if ($taskVersion -in @('3.11', '3.12')) { $Python = $taskCandidate; break }
        }
    }
}
if (-not $Python) { throw 'Instal Python 3.11/3.12, lalu jalankan scripts/setup-local.ps1 -Python path/python.exe' }
if (-not (Test-Path '.venv/Scripts/python.exe')) { Run-Checked $Python @('-m', 'venv', '.venv') }
$taskPython = Join-Path $taskRoot '.venv\Scripts\python.exe'
Run-Checked $taskPython @('-m', 'ensurepip', '--upgrade')
if (-not (Test-Path '.local-ai/TripoSR/tsr/system.py')) {
    Run-Checked 'git' @('clone', 'https://github.com/VAST-AI-Research/TripoSR.git', '.local-ai/TripoSR')
}
Run-Checked 'git' @('-C', '.local-ai/TripoSR', 'checkout', '--detach', '107cefdc244c39106fa830359024f6a2f1c78871')
Run-Checked $taskPython @('-m', 'pip', 'install', '--no-cache-dir', 'torch==2.5.1', '--index-url', 'https://download.pytorch.org/whl/cu124')
Run-Checked $taskPython @('-m', 'pip', 'install', '--no-cache-dir', '-r', 'ai/requirements.txt')
Run-Checked $taskPython @('ai/download_models.py')
Write-Host 'TripoSR siap. Jalankan npm run dev, lalu pilih TripoSR lokal pada web.'

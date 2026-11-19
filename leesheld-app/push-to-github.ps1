$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI ontbreekt. Installeer eerst https://cli.github.com/ en open daarna een nieuwe PowerShell.'
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git ontbreekt. Installeer Git for Windows: https://git-scm.com/download/win'
}

gh auth status
if (-not (Test-Path '.git')) { git init }
git add .

$hasHead = $true
git rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { $hasHead = $false }
if (-not $hasHead) {
  git -c user.name='Leesheld setup' -c user.email='leesheld@users.noreply.github.com' commit -m 'Initial Leesheld app'
} else {
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git -c user.name='Leesheld setup' -c user.email='leesheld@users.noreply.github.com' commit -m 'Update Leesheld app' }
}

# Maak de privérepository aan als deze nog niet bestaat; anders push naar de bestaande.
$repoName = 'leesheld'
$existingRepo = ''
try {
  $existingRepo = gh repo view $repoName --json nameWithOwner --jq .nameWithOwner 2>$null
} catch {
  $existingRepo = ''
}
if ([string]::IsNullOrWhiteSpace($existingRepo)) {
  gh repo create $repoName --private --source . --remote origin --push
} else {
  $remoteUrl = "https://github.com/$existingRepo.git"
  $hasOrigin = $true
  git remote get-url origin 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { $hasOrigin = $false }
  if ($hasOrigin) { git remote set-url origin $remoteUrl } else { git remote add origin $remoteUrl }
  git branch -M main
  git push -u origin main
}

Write-Host ''
Write-Host 'Gereed! De Leesheld-code staat in je privérepository:' -ForegroundColor Green
if ($existingRepo) { Write-Host "https://github.com/$existingRepo" } else { gh repo view --json url --jq .url }
Write-Host 'Open nu Coolify en importeer deze repository als Docker Compose.'

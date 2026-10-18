# Short-lived worktrees for parallel agent work.
#   .\scripts\worktree.ps1 new <name> [-Base dev]   create ..\pliable-wt\<name> on branch agent/<name>
#   .\scripts\worktree.ps1 remove <name> [-Force]    remove it once the branch is merged
#   .\scripts\worktree.ps1 refresh <name|all>      recopy the ignored project files (run before assigning or resuming an agent)
#   .\scripts\worktree.ps1 list
# The ignored project files (root-level notes such as the agent instructions, and docs/research) are copied in
# and stay ignored, so they are never pushed.
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("new", "remove", "refresh", "list")][string]$Action,
    [Parameter(Position = 1)][string]$Name,
    [string]$Base = "dev",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repo = (git rev-parse --show-toplevel).Trim() -replace "/", "\"
$root = Join-Path (Split-Path $repo -Parent) "pliable-wt"
# Ignored markdown files in the repo root, found by asking git rather than listing names.
$rootNotes = Get-ChildItem $repo -File -Filter *.md | Where-Object {
    git -C $repo check-ignore -q -- $_.Name; $LASTEXITCODE -eq 0
} | ForEach-Object { $_.Name }
# Ignored settings files inside hidden folders at the repo root (tracked ones come with the checkout anyway).
$hiddenSettings = Get-ChildItem $repo -Directory -Force | Where-Object { $_.Name -like ".*" -and $_.Name -ne ".git" } | ForEach-Object {
    $dir = $_.Name
    Get-ChildItem (Join-Path $repo $dir) -File -Filter "settings*.json" -ErrorAction SilentlyContinue | ForEach-Object { "$dir/$($_.Name)" }
} | Where-Object { git -C $repo check-ignore -q -- $_; $LASTEXITCODE -eq 0 }
$localFiles = @($rootNotes) + @("docs/research") + @($hiddenSettings)

# Each worktree gets its own core port (8801-8899) and Vite port (5201-5299), never one in use by another worktree
# or by a listening process. The main checkout keeps 8765 and Vite's default.
function Get-AssignedCorePorts {
    git worktree list --porcelain | Where-Object { $_ -like "worktree *" } | ForEach-Object {
        $envFile = Join-Path ($_ -replace "^worktree ", "") "app\.env"
        if (Test-Path $envFile) { Select-String -Path $envFile -Pattern "^VITE_CORE_PORT=(\d+)" | ForEach-Object { [int]$_.Matches[0].Groups[1].Value } }
    }
}
function Test-PortFree($port) { -not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }
function Get-PortPair {
    $taken = @(Get-AssignedCorePorts)
    foreach ($n in 1..99) {
        $core = 8800 + $n; $vite = 5200 + $n
        if ($taken -notcontains $core -and (Test-PortFree $core) -and (Test-PortFree $vite)) { return @($core, $vite) }
    }
    Fail "No free port pair left; remove some worktrees."
}

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if ($Action -eq "list") { git worktree list; exit 0 }
if (-not $Name -or $Name -notmatch '^[A-Za-z0-9._-]+$') { Fail "Give a name using letters, digits, dot, dash or underscore." }

$path = Join-Path $root $Name
$branch = "agent/$Name"

if ($Action -eq "refresh") {
    # Ignored files are not part of a checkout, so an old worktree keeps stale rules and research until they are copied again.
    $targets = if ($Name -eq "all") { @(Get-ChildItem $root -Directory | ForEach-Object { $_.FullName }) } else { @($path) }
    foreach ($t in $targets) {
        if (-not (Test-Path $t)) { Fail "$t does not exist." }
        foreach ($f in $localFiles) {
            $src = Join-Path $repo $f
            if (Test-Path $src) {
                $dst = Join-Path $t $f
                New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
                Copy-Item $src $dst -Recurse -Force
            }
        }
        Write-Host "Refreshed $t"
    }
    exit 0
}

if ($Action -eq "new") {
    if (Test-Path $path) { Fail "$path already exists." }
    git show-ref --verify --quiet "refs/heads/$branch"
    if ($LASTEXITCODE -eq 0) { Fail "Branch $branch already exists." }

    # Keep the local-only files ignored in every worktree, whatever the global ignore says.
    $exclude = Join-Path (git rev-parse --git-common-dir).Trim() "info\exclude"
    New-Item -ItemType Directory -Force (Split-Path $exclude) | Out-Null
    $have = if (Test-Path $exclude) { Get-Content $exclude } else { @() }
    foreach ($f in $localFiles) {
        $entry = if ($f -eq "docs/research") { "/docs/research/" } else { "/$f" }
        if ($have -notcontains $entry) { Add-Content -Path $exclude -Value $entry }
    }

    New-Item -ItemType Directory -Force $root | Out-Null
    git worktree add -b $branch $path $Base
    if ($LASTEXITCODE -ne 0) { Fail "git worktree add failed." }

    foreach ($f in $localFiles) {
        $src = Join-Path $repo $f
        if (Test-Path $src) {
            $dst = Join-Path $path $f
            New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
            Copy-Item $src $dst -Recurse -Force
        } else {
            Write-Host "Skipped $f (not found in the main checkout)." -ForegroundColor Yellow
        }
    }

    $core, $vite = Get-PortPair
    "VITE_CORE_PORT=$core" | Set-Content -Path (Join-Path $path "app\.env") -Encoding ascii
    # Autosave and the restore prompt live in one folder per machine unless PLIABLE_DATA points elsewhere,
    # so each worktree gets its own folder and never offers or overwrites another run's session.
    $dataDir = Join-Path $path ".agent-data"
    New-Item -ItemType Directory -Force $dataDir | Out-Null
    $portsFile = Join-Path $path "agent-ports.txt"
    @(
        "This worktree's ports and data folder. Use these and no others; the main checkout and other agents use different ones.",
        "core server  (from core\): `$env:PLIABLE_DATA = '$dataDir'; uv run pliable-server --port $core",
        "frontend dev (from app\):  npm run dev -- --port $vite --strictPort",
        "open:        http://localhost:$vite",
        "(app\.env sets VITE_CORE_PORT=$core so the frontend finds the core server. PLIABLE_DATA keeps autosave and the restore prompt private to this worktree.)"
    ) | Set-Content -Path $portsFile -Encoding ascii
    $have = Get-Content $exclude
    foreach ($entry in @("/agent-ports.txt", "/.agent-data/")) {
        if ($have -notcontains $entry) { Add-Content -Path $exclude -Value $entry }
    }

    $leaked = git -C $path status --porcelain
    if ($leaked) { Write-Host "Warning: copied files show up in git status, they would be committed:`n$leaked" -ForegroundColor Red }

    Write-Host "Worktree ready: $path (branch $branch from $Base)"
    Write-Host "Assigned ports: core $core, frontend $vite (details in agent-ports.txt in the worktree)."
    Write-Host "Next: in core\ run 'uv sync', in app\ run 'npm ci'. Give the agent these ports in its prompt."
    exit 0
}

# remove
if (-not (Test-Path $path)) { Fail "$path does not exist." }
$dirty = git -C $path status --porcelain
if ($dirty -and -not $Force) { Fail "Uncommitted changes in $path (copied ignored files are not counted):`n$dirty`nCommit or discard them, or pass -Force." }
git merge-base --is-ancestor $branch $Base
if ($LASTEXITCODE -ne 0 -and -not $Force) { Fail "$branch is not merged into $Base. Merge it first, or pass -Force to discard it." }

$flag = if ($Force) { "--force" } else { $null }
git worktree remove $flag $path
if ($LASTEXITCODE -ne 0) { Fail "git worktree remove failed." }
git branch ($(if ($Force) { "-D" } else { "-d" })) $branch
Write-Host "Removed $path and branch $branch."

# Short-lived worktrees for parallel agent work.
#   .\scripts\worktree.ps1 new <name> [-Base dev]   create ..\pliable-wt\<name> on branch agent/<name>
#   .\scripts\worktree.ps1 remove <name> [-Force]    remove it once the branch is merged
#   .\scripts\worktree.ps1 list
# The ignored project files (root-level notes such as the agent instructions, and docs/research) are copied in
# and stay ignored, so they are never pushed.
param(
    [Parameter(Mandatory = $true, Position = 0)][ValidateSet("new", "remove", "list")][string]$Action,
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
$localFiles = @($rootNotes) + @("docs/research")

function Fail($msg) { Write-Host $msg -ForegroundColor Red; exit 1 }

if ($Action -eq "list") { git worktree list; exit 0 }
if (-not $Name -or $Name -notmatch '^[A-Za-z0-9._-]+$') { Fail "Give a name using letters, digits, dot, dash or underscore." }

$path = Join-Path $root $Name
$branch = "agent/$Name"

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

    $leaked = git -C $path status --porcelain
    if ($leaked) { Write-Host "Warning: copied files show up in git status, they would be committed:`n$leaked" -ForegroundColor Red }

    Write-Host "Worktree ready: $path (branch $branch from $Base)"
    Write-Host "Next: in core\ run 'uv sync', in app\ run 'npm ci'. Use a different server port than the main checkout (8765)."
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

#!/usr/bin/env bash
# release.sh — cut a new version tag and push it to trigger the Release workflow.
#
# Usage:
#   ./release.sh patch          # 0.1.0 → 0.1.1
#   ./release.sh minor          # 0.1.0 → 0.2.0
#   ./release.sh major          # 0.1.0 → 1.0.0
#   ./release.sh 1.2.3          # explicit version
#   ./release.sh patch --dry-run  # preview without pushing

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

die() { red "error: $*"; exit 1; }

# ---------------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------------

BUMP="${1:-}"
DRY_RUN=false

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

[[ -z "$BUMP" ]] && die "Usage: $0 patch|minor|major|<version> [--dry-run]"

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

command -v git  >/dev/null 2>&1 || die "git is not installed"
command -v node >/dev/null 2>&1 || die "node is not installed"

# Must be run from the repo root (where package.json lives)
[[ -f package.json ]] || die "package.json not found — run this from the project root"

# Ensure working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree has uncommitted changes. Commit or stash them first."
fi

# Ensure we're on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  yellow "warning: You are on branch '$CURRENT_BRANCH', not 'main'."
  read -r -p "Continue anyway? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# Pull latest
git fetch --tags --quiet

# ---------------------------------------------------------------------------
# Compute new version
# ---------------------------------------------------------------------------

CURRENT_VERSION=$(node -p "require('./package.json').version")

bump_semver() {
  local version="$1" part="$2"
  IFS='.' read -r major minor patch <<< "${version%%-*}"
  case "$part" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

case "$BUMP" in
  patch|minor|major)
    NEW_VERSION=$(bump_semver "$CURRENT_VERSION" "$BUMP")
    ;;
  --dry-run)
    # Called as first arg by mistake
    die "Usage: $0 patch|minor|major|<version> [--dry-run]"
    ;;
  *)
    # Treat as explicit version — strip leading 'v' if present
    NEW_VERSION="${BUMP#v}"
    # Basic semver validation
    if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][a-zA-Z0-9.]+)?$ ]]; then
      die "'$NEW_VERSION' is not a valid semver version"
    fi
    ;;
esac

TAG="v${NEW_VERSION}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "Tag $TAG already exists. Choose a different version."
fi

# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

echo ""
bold  "  Release summary"
echo  "  ─────────────────────────────"
echo  "  Current version : $CURRENT_VERSION"
echo  "  New version     : $NEW_VERSION"
echo  "  Tag             : $TAG"
echo  "  Branch          : $CURRENT_BRANCH"
$DRY_RUN && yellow "  Mode            : DRY RUN — nothing will be pushed"
echo ""

if ! $DRY_RUN; then
  read -r -p "Proceed? [y/N] " CONFIRM
  [[ "$CONFIRM" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ---------------------------------------------------------------------------
# Tag and push
# ---------------------------------------------------------------------------

if $DRY_RUN; then
  green "Dry run complete — would have created and pushed tag $TAG"
  exit 0
fi

# Bump version in package.json (no git commit — the workflow handles CHANGELOG)
npm version "$NEW_VERSION" --no-git-tag-version --silent

git add package.json package-lock.json
git commit -m "chore(release): bump version to $NEW_VERSION"
git push origin "$CURRENT_BRANCH"

git tag -a "$TAG" -m "Release $TAG"
git push origin "$TAG"

echo ""
green "✓ Tag $TAG pushed — the Release workflow is now running."
echo  "  https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')/actions"

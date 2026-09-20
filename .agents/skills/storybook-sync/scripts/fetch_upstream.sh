#!/usr/bin/env bash
# Fetch and list upstream Storybook commits affecting monitored packages.
# Maintains a blobless clone cache at ~/.cache/storybook-upstream/.
#
# Noise filtering:
#   - Merge commits are excluded (--no-merges)
#   - "Bump version from ..." commits are excluded (--invert-grep). Every tag on
#     `next` points at one of these, so a tag..tag range is naturally clean.
#   - The upstream branch is `next` (Storybook's primary development branch)
set -euo pipefail

CACHE_DIR="${HOME}/.cache/storybook-upstream"
REPO_URL="https://github.com/storybookjs/storybook.git"
UPSTREAM_BRANCH="next"

# Monitored upstream paths — edit this list to track different packages.
# These use the `code/` prefix matching the Storybook 8.x+ monorepo layout.
PATHS=(
  "code/builders/builder-webpack5"
  "code/builders/builder-vite"
  "code/frameworks/react-vite"
  "code/frameworks/react-webpack5"
  "code/frameworks/vue3-vite"
  "code/frameworks/web-components-vite"
  "code/frameworks/html-vite"
  "code/presets/react-webpack"
  "code/lib/core-webpack"
)

FROM_REF=""
TO_REF=""
DIFF_HASH=""
FILES_HASH=""
RESOLVE_REFS=()
DIFF_ALL=false
SUMMARY=false
FILTER_HASHES=""
NO_FETCH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --from) FROM_REF="$2"; shift 2 ;;
    --to) TO_REF="$2"; shift 2 ;;
    --diff) DIFF_HASH="$2"; shift 2 ;;
    --files) FILES_HASH="$2"; shift 2 ;;
    --resolve)
      shift
      if [[ $# -eq 0 || $1 == --* ]]; then
        echo ":: --resolve needs at least one ref" >&2
        exit 1
      fi
      while [[ $# -gt 0 && $1 != --* ]]; do
        RESOLVE_REFS+=("$1")
        shift
      done
      ;;
    --diff-all) DIFF_ALL=true; shift ;;
    --summary) SUMMARY=true; shift ;;
    --hashes) FILTER_HASHES="$2"; shift 2 ;;
    --no-fetch) NO_FETCH=true; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: fetch_upstream.sh [OPTIONS]

Range options (shared across modes; REF is a tag, commit sha, or branch; branches resolve to origin/<branch>):
  --from REF      Start ref, inclusive
  --to REF        End ref, inclusive

Modes:
  (default)       List commits: HASH|DATE|AUTHOR|SUBJECT
  --summary       List commits with diff line counts: HASH|DATE|AUTHOR|SUBJECT|LINES
  --diff-all      Output metadata + file list + diff for every commit in range
  --diff HASH     Show diff for one commit (monitored paths only)
  --files HASH    List monitored files changed by one commit
  --resolve REF...  Validate refs (exist, reachable from origin/next); print SHA<TAB>LABEL per ref

Filtering:
  --hashes H1,H2  Limit --diff-all or --summary to specific commits (skip range query)
  --no-fetch      Skip git fetch (use when cache was already updated this session)

Noise filtering (applied automatically):
  - Merge commits are excluded
  - "Bump version from ..." commits are excluded
  - Default upstream branch: next
HELP
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Ensure cache ──────────────────────────────────────────────────────
if [ -d "$CACHE_DIR/.git" ]; then
  if [ "$NO_FETCH" = false ]; then
    echo ":: Fetching latest upstream ($UPSTREAM_BRANCH)..." >&2
    git -C "$CACHE_DIR" fetch --prune --tags origin "$UPSTREAM_BRANCH" 2>/dev/null
  fi
else
  echo ":: First run — cloning storybookjs/storybook (blobless, ~1-2 min)..." >&2
  mkdir -p "$(dirname "$CACHE_DIR")"
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$CACHE_DIR" 2>&1 | tail -1 >&2
fi

# Validate REF (exists, reachable from origin/next) and print "SHA<TAB>LABEL".
# LABEL is the ref as written, or the 8-char short form of a full 40-hex sha.
resolve_ref() {
  local sha
  sha=$(git -C "$CACHE_DIR" rev-parse --verify --quiet "origin/${1}^{commit}" \
    || git -C "$CACHE_DIR" rev-parse --verify --quiet "${1}^{commit}") \
    || { echo ":: Unknown ref: $1" >&2; exit 1; }
  git -C "$CACHE_DIR" merge-base --is-ancestor "$sha" "origin/$UPSTREAM_BRANCH" \
    || { echo ":: Ref not reachable from origin/$UPSTREAM_BRANCH: $1" >&2; exit 1; }
  local label=$1
  [[ $1 =~ ^[a-f0-9]{40}$ ]] && label=${1:0:8}
  printf '%s\t%s\n' "$sha" "$label"
}

# ── Resolve refs ─────────────────────────────────────────────────────
if [ ${#RESOLVE_REFS[@]} -gt 0 ]; then
  for ref in "${RESOLVE_REFS[@]}"; do
    resolve_ref "$ref"
  done
  exit 0
fi

# ── Single-commit: show diff ─────────────────────────────────────────
if [ -n "$DIFF_HASH" ]; then
  git -C "$CACHE_DIR" show "$DIFF_HASH" -- "${PATHS[@]}"
  exit 0
fi

# ── Single-commit: list files ────────────────────────────────────────
if [ -n "$FILES_HASH" ]; then
  git -C "$CACHE_DIR" diff-tree --no-commit-id --name-only -r "$FILES_HASH" -- "${PATHS[@]}"
  exit 0
fi

# ── Build range args (shared by list, summary, and diff-all) ─────────
if [ -z "$FILTER_HASHES" ] || { [ "$SUMMARY" = false ] && [ "$DIFF_ALL" = false ]; }; then
  if [ -z "$FROM_REF" ] || [ -z "$TO_REF" ]; then
    echo ":: Range modes need both --from and --to" >&2
    exit 1
  fi
  FROM_SHA=$(resolve_ref "$FROM_REF")
  FROM_SHA=${FROM_SHA%%$'\t'*}
  TO_SHA=$(resolve_ref "$TO_REF")
  TO_SHA=${TO_SHA%%$'\t'*}
  git -C "$CACHE_DIR" merge-base --is-ancestor "$FROM_SHA" "$TO_SHA" \
    || { echo ":: --to $TO_REF does not come after --from $FROM_REF" >&2; exit 1; }
  RANGE_ARGS=("$TO_SHA" --not "${FROM_SHA}^@")
fi

build_log_cmd() {
  LOG_CMD=(git -C "$CACHE_DIR" log)
  LOG_CMD+=(--no-merges)
  LOG_CMD+=(--invert-grep --grep='Bump version from')
  LOG_CMD+=(--reverse)
}

# ── Resolve hash list (from --hashes or git log) ─────────────────────
resolve_hashes() {
  if [ -n "$FILTER_HASHES" ]; then
    echo "$FILTER_HASHES" | tr ',' '\n'
  else
    build_log_cmd
    LOG_CMD+=("--pretty=format:%H")
    LOG_CMD+=("${RANGE_ARGS[@]}")
    LOG_CMD+=("--" "${PATHS[@]}")
    "${LOG_CMD[@]}" 2>/dev/null || true
  fi
}

# ── Summary mode ─────────────────────────────────────────────────────
if [ "$SUMMARY" = true ]; then
  HASHES=$(resolve_hashes)

  if [ -z "$HASHES" ]; then
    echo ":: No commits found in the specified range for monitored paths." >&2
    exit 0
  fi

  COUNT=$(echo "$HASHES" | wc -l | tr -d ' ')
  echo ":: Found $COUNT commit(s)" >&2

  while IFS= read -r hash; do
    META=$(git -C "$CACHE_DIR" log -1 --pretty=format:"%H|%ai|%an|%s" "$hash")
    LINES=$(git -C "$CACHE_DIR" diff-tree --no-commit-id --numstat -r "$hash" -- "${PATHS[@]}" \
      | awk '{ a += $1; d += $2 } END { print a + 0 "+" d + 0 }')
    echo "${META}|${LINES}"
  done <<< "$HASHES"

  exit 0
fi

# ── Batch diff mode ──────────────────────────────────────────────────
if [ "$DIFF_ALL" = true ]; then
  HASHES=$(resolve_hashes)

  if [ -z "$HASHES" ]; then
    echo ":: No commits found in the specified range for monitored paths." >&2
    echo ":: Tip: verify the path prefix matches this Storybook version:" >&2
    echo "::   git -C $CACHE_DIR ls-tree --name-only -d origin/$UPSTREAM_BRANCH" >&2
    exit 0
  fi

  COUNT=$(echo "$HASHES" | wc -l | tr -d ' ')
  echo ":: Outputting metadata + diff for $COUNT commit(s)..." >&2

  IDX=0
  while IFS= read -r hash; do
    IDX=$((IDX + 1))

    # Metadata line
    META=$(git -C "$CACHE_DIR" log -1 --pretty=format:"%H|%ai|%an|%s" "$hash")
    # Files touched (monitored paths only)
    FILES=$(git -C "$CACHE_DIR" diff-tree --no-commit-id --name-only -r "$hash" -- "${PATHS[@]}")
    # Diff (monitored paths only, suppress commit header since we print our own)
    DIFF=$(git -C "$CACHE_DIR" show --pretty=format:"" "$hash" -- "${PATHS[@]}")

    echo "════════════════════════════════════════════════════════════════"
    echo "COMMIT $IDX/$COUNT"
    echo "$META"
    echo "FILES:"
    echo "$FILES" | sed 's/^/  /'
    echo "DIFF:"
    echo "$DIFF"
    echo ""
  done <<< "$HASHES"

  exit 0
fi

# ── List mode (default) ──────────────────────────────────────────────
build_log_cmd
LOG_CMD+=("--pretty=format:%H|%ai|%an|%s")
LOG_CMD+=("${RANGE_ARGS[@]}")
LOG_CMD+=("--" "${PATHS[@]}")

RESULT=$("${LOG_CMD[@]}" 2>/dev/null || true)

if [ -z "$RESULT" ]; then
  echo ":: No commits found in the specified range for monitored paths." >&2
  echo ":: Tip: verify the path prefix matches this Storybook version:" >&2
  echo "::   git -C $CACHE_DIR ls-tree --name-only -d origin/$UPSTREAM_BRANCH" >&2
  exit 0
fi

COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
echo ":: Found $COUNT commit(s) touching monitored packages (after filtering bumps and merges)" >&2
echo "$RESULT"

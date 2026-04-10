#!/usr/bin/env bash
# Fetch and list upstream Storybook commits affecting monitored packages.
# Maintains a blobless clone cache at ~/.cache/storybook-upstream/.
#
# Noise filtering:
#   - Merge commits are excluded (--no-merges)
#   - "Bump version from ..." commits are excluded (--invert-grep)
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
  "code/lib/core-webpack"
)

SINCE=""
UNTIL=""
DAYS=""
FROM_REF=""
TO_REF=""
DIFF_HASH=""
FILES_HASH=""
DIFF_ALL=false
SUMMARY=false
FILTER_HASHES=""
NO_FETCH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --since) SINCE="$2"; shift 2 ;;
    --until) UNTIL="$2"; shift 2 ;;
    --days) DAYS="$2"; shift 2 ;;
    --from) FROM_REF="$2"; shift 2 ;;
    --to) TO_REF="$2"; shift 2 ;;
    --diff) DIFF_HASH="$2"; shift 2 ;;
    --files) FILES_HASH="$2"; shift 2 ;;
    --diff-all) DIFF_ALL=true; shift ;;
    --summary) SUMMARY=true; shift ;;
    --hashes) FILTER_HASHES="$2"; shift 2 ;;
    --no-fetch) NO_FETCH=true; shift ;;
    --report-name) echo "upstream-sync-report-$(date +%Y%m%d-%H%M%S).md"; exit 0 ;;
    -h|--help)
      cat <<'HELP'
Usage: fetch_upstream.sh [OPTIONS]

Range options (shared across modes):
  --days N        Look back N days from today (uses system clock, recommended)
  --since DATE    Start date (e.g. 2025-12-01)
  --until DATE    End date (defaults to today)
  --from REF      Start ref/tag (e.g. v8.4.0)
  --to REF        End ref/tag (e.g. v8.5.0)

Modes:
  (default)       List commits: HASH|DATE|AUTHOR|SUBJECT
  --summary       List commits with diff line counts: HASH|DATE|AUTHOR|SUBJECT|LINES
  --diff-all      Output metadata + file list + diff for every commit in range
  --diff HASH     Show diff for one commit (monitored paths only)
  --files HASH    List monitored files changed by one commit
  --report-name   Print a timestamped report filename and exit

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

# ── Resolve --days into --since/--until from system clock ─────────────
if [ -n "$DAYS" ]; then
  UNTIL=$(date +%Y-%m-%d)
  # macOS date syntax, with GNU fallback
  SINCE=$(date -v-"${DAYS}"d +%Y-%m-%d 2>/dev/null || date -d "${DAYS} days ago" +%Y-%m-%d)
  echo ":: System time: $(date '+%Y-%m-%d %H:%M:%S %Z')" >&2
  echo ":: Resolved --days $DAYS → --since $SINCE --until $UNTIL" >&2
fi

# ── Ensure cache ──────────────────────────────────────────────────────
if [ -d "$CACHE_DIR/.git" ]; then
  if [ "$NO_FETCH" = false ]; then
    echo ":: Fetching latest upstream ($UPSTREAM_BRANCH)..." >&2
    git -C "$CACHE_DIR" fetch --all --tags --prune 2>/dev/null
  fi
else
  echo ":: First run — cloning storybookjs/storybook (blobless, ~1-2 min)..." >&2
  mkdir -p "$(dirname "$CACHE_DIR")"
  git clone --filter=blob:none --no-checkout "$REPO_URL" "$CACHE_DIR" 2>&1 | tail -1 >&2
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
RANGE_ARGS=()
if [ -n "$FROM_REF" ] && [ -n "$TO_REF" ]; then
  RANGE_ARGS+=("${FROM_REF}..${TO_REF}")
elif [ -n "$FROM_REF" ]; then
  RANGE_ARGS+=("${FROM_REF}..origin/${UPSTREAM_BRANCH}")
else
  RANGE_ARGS+=("origin/${UPSTREAM_BRANCH}")
fi

build_log_cmd() {
  LOG_CMD=(git -C "$CACHE_DIR" log)
  LOG_CMD+=(--no-merges)
  LOG_CMD+=(--invert-grep --grep='Bump version from')
  LOG_CMD+=(--reverse)
  [ -n "$SINCE" ] && LOG_CMD+=("--since=${SINCE}")
  [ -n "$UNTIL" ] && LOG_CMD+=("--until=${UNTIL}")
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

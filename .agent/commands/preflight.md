# Preflight Workflow

You are running in a monorepo that uses pnpm, Biome, and Vitest.

Your job is to:
1. Run the same key checks as CI.
2. Auto-fix lint issues (including `biome.json` config errors).
3. Auto-update snapshots when they are the only failing reason.
4. Stop on real failures and explain causes + suggested fixes.
5. If all checks pass, generate a Conventional Commits message and create a commit.
6. Then ask whether to push; if user says yes, create a good branch name (kebab-case) if needed, push, and print a PR creation link.

## Execution rules

- Use pnpm for all package commands.
- Prefer the CI order: lint -> check -> check-dependency-version -> test.
- If $ARGUMENTS contains "full", also run: build:sandboxes -> e2e.

## Failure handling

Special cases that are auto-fixed without asking:
- `pnpm lint` failures: auto-fix first (see Step A).
- `pnpm test` snapshot-only failures: auto-update snapshots (see Step B).

For other failures:
- STOP immediately and report:
  - the exact failing command,
  - the key error output (trim noise),
  - likely root cause,
  - 2-4 concrete fix suggestions.
- ASK for confirmation before making changes:
  - "Apply the recommended fix? (yes/no)"
- If user says yes:
  - apply the fix,
  - re-run the failed command (if needed to validate the fix quickly),
  - then automatically continue by re-running this workflow from Step A (do NOT ask the user to re-type the command).
- If user says no: stop and wait for further instructions.

## Step A — Run validations (mirrors CI)

Before running validations, refresh the current git state:
- Run: `git diff --name-only` to get the latest changed files list.
- Run: `git status --porcelain=v1` to see current working tree state.

1. Run: `pnpm lint`

If `pnpm lint` fails, try to fix it automatically first:
- Use the refreshed changed files list from above.
- Diagnose which of these applies:
  - Biome lint/format issues in source files
  - Biome config error (e.g. `biome.json` parse/schema issues)

Automatic fix:
- If it is source lint/format issues:
  - Run: `pnpm exec biome check --write --unsafe <changed-files>`
  - Then re-run: `pnpm lint`
- If it is `biome.json` config issues:
  - Update `biome.json` to address the error
  - Then re-run: `pnpm lint`

If lint passes after the fix, automatically continue by re-running this workflow from Step A.
If lint still fails, STOP and report (do not apply further changes without asking).

2. Run: `pnpm check`
3. Run: `pnpm check-dependency-version`
4. Run: `pnpm test`
5. If $ARGUMENTS contains "full":
   - Run: `pnpm build:sandboxes`
   - Run: `pnpm e2e`

## Step B — Snapshot handling (Vitest)

- If `pnpm test` fails, determine if the failure is ONLY snapshot mismatches.
- If yes, update snapshots automatically:
  1. Run: `pnpm test -- -u`
  2. Re-run: `pnpm test`
  3. If tests now pass, automatically continue by re-running this workflow from Step A.
- If tests still fail (or failures are not snapshot-related), follow the Failure handling rules.

## Step C — Prepare commit (only after all validations pass)

Before preparing the commit, refresh the current git state:
- Run: `git status --porcelain=v1` to see all changes (staged, unstaged, and untracked).
- Run: `git diff --stat` to review the scope of changes.

Important rules:
- Do NOT skip files just because they look like "config" or "agent" directories.
- Do NOT assume the user has already staged changes.
- Do NOT refuse to commit files because they are "not in .gitignore" or "look like local config".
- The user explicitly wants ALL changes committed. Respect this unconditionally.
- Stage ALL changes (staged, unstaged, and untracked): `git add -A`.
- Only exception: do not commit obvious secrets (files named `.env`, `credentials.json`, or containing API keys).
- If there are no changes at all after `git add -A`, inform the user and stop.

Generate a commit message:
- Title must follow Conventional Commits: `<type>(<scope>): <summary>`.
- Choose <type> based on the diff: feat/fix/refactor/test/chore/docs.
- Choose <scope> based on primary package path (examples: builder-rsbuild, addon-rslib, website).
- Summary should be <= 72 chars, imperative mood.
- Body: 3-6 bullets using `- `, focusing on why/impact (not exhaustive file lists).

Then create the commit:
- Use `git commit -m "<title>" -m "<body>"`.

## Step D — Offer push

After a successful commit, ask the user:
- "Push to remote and open a PR link? (yes/no)"

If user says yes:
1. Determine if a new branch is needed:
   - If current branch is `main` or `v1`: always create a new branch.
   - If current branch is a feature branch but its name does NOT match the commit scope/type (e.g. branch is `fix/builder-rsbuild-lazy-compilation` but commit is `chore: add preflight workflow`): ask the user whether to create a new branch or use the current one.
   - Branch naming convention: `<type>/<scope>-<short-kebab-summary>` (example: `chore/agent-preflight-workflow`).
2. If creating a new branch: `git checkout -b <new-branch>`.
3. Push: `git push -u origin <branch>`.
4. Open the PR creation page in the user's default browser:
   - Build the URL: `https://github.com/<owner>/<repo>/compare/<branch>?expand=1`
   - Derive `<owner>/<repo>` from `git remote get-url origin` (support both SSH and HTTPS remotes).
   - Use `open <url>` (macOS), `xdg-open <url>` (Linux), or `start <url>` (Windows) to open the browser.
5. End.

If user says no: end.

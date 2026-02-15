Use English only.
You are helping maintainers of storybook-rsbuild.
Given the following upstream Storybook commits that touched code/frameworks/*/src, identify which commits require sync work in this downstream repository.
Return strict JSON array only, with one item per commit that requires sync.

JSON schema:
[
  {
    "sha": "full commit SHA",
    "sync_required": true,
    "priority": "high|medium|low",
    "reason": "short reason referencing changed files",
    "suggested_actions": [
      "specific action 1",
      "specific action 2"
    ]
  }
]

Rules:
- Keep output strictly valid JSON.
- Return only English text in every reason and suggested action.
- Exclude commits where sync_required is false.
- If none require sync, return [] exactly.

Commits:
{{COMMITS_JSON}}

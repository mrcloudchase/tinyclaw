---
description: GitHub operations using the gh CLI
tags: [github, git, dev]
---

Use the `bash` tool to run `gh` CLI commands for GitHub operations.

## Capabilities

- **Pull Requests**: Create, list, review, merge, and close PRs
- **Issues**: Create, list, comment, and close issues
- **CI/CD**: Check workflow runs, view logs, re-run jobs
- **Repos**: Clone, fork, view info, manage releases

## Common Commands

```bash
# Pull Requests
gh pr list
gh pr create --title "Title" --body "Description"
gh pr view 123
gh pr merge 123
gh pr checks 123

# Issues
gh issue list
gh issue create --title "Bug" --body "Description"
gh issue view 42
gh issue close 42

# CI/CD
gh run list
gh run view 12345
gh run rerun 12345

# Releases
gh release list
gh release create v1.0.0 --notes "Release notes"
```

## Notes

- Requires `gh` CLI installed and authenticated (`gh auth login`)
- Always confirm destructive operations (merge, close, delete) with the user

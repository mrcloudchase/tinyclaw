---
description: Run coding agents (Claude Code, Codex, OpenCode) as background tasks for parallel development
tags: [coding, agents, automation, development]
---

# Coding Agent

Use bash with background mode to run coding agents for programmatic control.

## Quick Start: One-Shot Tasks

```bash
# Claude Code
claude 'Add error handling to the API calls'

# Codex (needs a git repo)
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && codex exec "Your prompt"
```

## Background Pattern

For longer tasks, use background mode:

```bash
# Start agent in target directory
cd ~/project && claude 'Build a snake game' &
AGENT_PID=$!

# Monitor progress
jobs -l

# Wait for completion
wait $AGENT_PID
```

## Parallel Issue Fixing with git worktrees

```bash
# Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# Launch agents in each
cd /tmp/issue-78 && claude 'Fix issue #78' &
cd /tmp/issue-99 && claude 'Fix issue #99' &

# Wait for all
wait

# Create PRs
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: issue 78"

# Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

## Supported Agents

| Agent | Command | Notes |
|-------|---------|-------|
| Claude Code | `claude 'prompt'` | Full-featured, uses Anthropic models |
| Codex | `codex exec 'prompt'` | Requires git repo, `--full-auto` for building |
| OpenCode | `opencode run 'prompt'` | Alternative agent |

## Rules

1. **Respect tool choice** — if user asks for Codex, use Codex
2. **Be patient** — don't kill sessions because they're "slow"
3. **Monitor progress** — check output periodically
4. **Parallel is OK** — run many agents at once for batch work
5. **Use worktrees** — avoid branch conflicts in parallel fixes

## Progress Updates

When spawning agents in the background:

- Send 1 short message when you start (what's running + where)
- Update only when something changes (milestone, error, completion)
- If you kill a session, say why immediately

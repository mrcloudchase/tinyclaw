---
description: Search and analyze session logs (older conversations) using jq
tags: [sessions, logs, history]
---

Search your complete conversation history stored in session JSONL files. Use this when a user references older conversations or asks what was said before.

## Location

Session logs live at: `~/.config/tinyclaw/sessions/`

- **`<session-name>.jsonl`** — Full conversation transcript per session

## Structure

Each `.jsonl` file contains messages with:

- `type`: "session" (metadata) or "message"
- `timestamp`: ISO timestamp
- `message.role`: "user", "assistant", or "toolResult"
- `message.content[]`: Text, thinking, or tool calls (filter `type=="text"` for readable content)

## Common Queries

### List all sessions by date and size

```bash
for f in ~/.config/tinyclaw/sessions/*.jsonl; do
  date=$(head -1 "$f" | jq -r '.timestamp' | cut -dT -f1)
  size=$(ls -lh "$f" | awk '{print $5}')
  echo "$date $size $(basename $f)"
done | sort -r
```

### Extract user messages from a session

```bash
jq -r 'select(.message.role == "user") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl
```

### Search for keyword in assistant responses

```bash
jq -r 'select(.message.role == "assistant") | .message.content[]? | select(.type == "text") | .text' <session>.jsonl | rg -i "keyword"
```

### Search across ALL sessions

```bash
rg -l "phrase" ~/.config/tinyclaw/sessions/*.jsonl
```

### Count messages in a session

```bash
jq -s '{
  messages: length,
  user: [.[] | select(.message.role == "user")] | length,
  assistant: [.[] | select(.message.role == "assistant")] | length,
  first: .[0].timestamp,
  last: .[-1].timestamp
}' <session>.jsonl
```

### Tool usage breakdown

```bash
jq -r '.message.content[]? | select(.type == "toolCall") | .name' <session>.jsonl | sort | uniq -c | sort -rn
```

## Tips

- Sessions are append-only JSONL (one JSON object per line)
- Large sessions can be several MB — use `head`/`tail` for sampling
- Requires `jq` and optionally `rg` (ripgrep) on PATH

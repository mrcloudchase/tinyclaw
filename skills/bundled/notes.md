---
description: Manage markdown notes using file tools
tags: [notes, productivity, files]
---

Manage a personal notes directory using TinyClaw's built-in file tools.

## Notes Directory

Default: `~/notes/` (configurable via skill config).

## Commands

- `/notes create <title>` — Create a new note with the given title
- `/notes list` — List all notes in the directory
- `/notes search <query>` — Search note contents using `grep`
- `/notes read <filename>` — Read a specific note
- `/notes edit <filename>` — Edit a specific note
- `/notes delete <filename>` — Delete a note (confirm with user first)

## Note Format

Each note is a markdown file with a YAML header:

```markdown
---
title: Note Title
created: 2025-01-15T10:30:00Z
tags: [tag1, tag2]
---

Note content here...
```

## Implementation

- Use `glob` to list `~/notes/**/*.md`
- Use `read` to view note contents
- Use `write` to create new notes
- Use `edit` to modify existing notes
- Use `grep` to search across all notes
- Filenames: lowercase, hyphens for spaces, `.md` extension (e.g., `my-meeting-notes.md`)

## Guidelines

- Always create the `~/notes/` directory if it doesn't exist (use `bash mkdir -p`)
- Add timestamps to new notes automatically
- Suggest tags based on content when creating notes
- Works on macOS, Linux, and Windows — no external dependencies required

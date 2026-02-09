---
description: Create or update TinyClaw skills with proper YAML frontmatter and markdown body
tags: [skills, development, extensibility]
---

# Skill Creator

Create effective skills for TinyClaw. Skills extend capabilities by providing specialized knowledge, workflows, and tool instructions.

## About Skills

Skills are markdown files with YAML frontmatter that provide domain-specific guidance. They are stored in:

- `skills/bundled/` — Built-in skills (ship with TinyClaw)
- `~/.config/tinyclaw/skills/` — User-installed skills
- Config-specified extra directories

## Skill Format

Every skill is a `.md` file:

```markdown
---
description: Brief description of what the skill does and when to use it
tags: [tag1, tag2]
---

Instructions and guidance for using the skill...
```

### Frontmatter (Required)

- `description`: Primary triggering mechanism. Include what the skill does AND when to use it.
- `tags`: Array of lowercase tags for categorization.

### Body (Required)

Markdown instructions loaded after the skill triggers. Keep under 500 lines.

## Core Principles

### Concise is Key

The context window is shared. Only add information the AI doesn't already have. Challenge each piece: "Does this justify its token cost?"

### Degrees of Freedom

Match specificity to task fragility:

- **High freedom** (text instructions): Multiple valid approaches, context-dependent
- **Medium freedom** (pseudocode): Preferred pattern exists, some variation OK
- **Low freedom** (specific scripts): Fragile operations, consistency critical

## Creating a New Skill

1. Determine the skill name (lowercase, hyphens: `my-skill`)
2. Create `skills/bundled/<name>.md` or `~/.config/tinyclaw/skills/<name>.md`
3. Write YAML frontmatter with clear `description` and `tags`
4. Write concise markdown instructions
5. Test by invoking `/skill-name` in a conversation

## Example Skill

```markdown
---
description: Generate commit messages following conventional commits format
tags: [git, development]
---

When asked to create a commit message:

1. Analyze the staged changes with `git diff --cached`
2. Determine the type: feat, fix, refactor, docs, test, chore
3. Write a concise subject line (<72 chars)
4. Add body with context if changes are complex

Format: `type(scope): description`
```

## Guidelines

- Include `description` in frontmatter — it determines when the skill triggers
- Keep instructions actionable and imperative
- Prefer examples over verbose explanations
- Reference tool names the AI should use (`bash`, `web_fetch`, etc.)
- Don't duplicate knowledge the AI already has

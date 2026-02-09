---
description: Multi-source web research
tags: [search, research, web]
---

Perform comprehensive web research on a topic.

## Process

1. **Initial Search** — Use `web_search` to find relevant results
2. **Deep Dive** — Use `web_fetch` on the most relevant URLs to get full content
3. **Synthesize** — Combine findings into a coherent research summary

## Output Format

1. **Answer** — Direct answer to the research question
2. **Sources** — List of sources consulted with titles and URLs
3. **Key Findings** — Bullet points of important discoveries
4. **Confidence** — How confident the findings are (high/medium/low) based on source quality and consensus

## Guidelines

- Search with multiple query variations to get comprehensive results
- Prioritize authoritative sources (official docs, academic papers, reputable publications)
- Cross-reference claims across multiple sources
- Note any conflicting information found
- Requires `BRAVE_API_KEY` environment variable for web search

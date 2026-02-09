---
description: Check weather for any location using wttr.in
tags: [weather, utility]
---

Use the `web_fetch` tool to get weather information from wttr.in.

## Usage

When the user asks about weather, fetch from `https://wttr.in/{location}?format=4` for a concise one-line summary, or `https://wttr.in/{location}?format=j1` for detailed JSON data.

## Examples

- `/weather London` → fetch `https://wttr.in/London?format=4`
- `/weather Tokyo` → fetch `https://wttr.in/Tokyo?format=4`
- `/weather` (no location) → fetch `https://wttr.in/?format=4` (auto-detect)

## Notes

- No API key required
- Supports city names, airport codes (e.g., `JFK`), and coordinates
- For detailed forecasts, use `format=j1` and summarize the JSON response

---
description: System and security health audit
tags: [system, security, diagnostics]
---

Perform a comprehensive health check of the TinyClaw instance and its environment.

## Checks to Run

1. **Config Validation** — Read and validate the config file, report any schema issues
2. **API Key Status** — Check if required API keys are set (without revealing them)
3. **Disk Usage** — Check available disk space for sessions, memory DB, and logs
4. **Memory DB** — Verify SQLite memory database is accessible and report entry count
5. **Session Files** — List active sessions, check for stale locks or corrupted files
6. **Security Audit** — Review security config (tool policy, SSRF protection, exec approval, pairing)
7. **Channel Status** — Check which channels are configured and if tokens are available
8. **Cron Jobs** — List active cron jobs and any missed runs
9. **Dependencies** — Check Node.js version meets minimum (>=22.12.0)

## Output Format

Present results as a structured report with status indicators:
- OK for passing checks
- WARN for non-critical issues
- FAIL for critical problems

Include actionable recommendations for any WARN or FAIL items.

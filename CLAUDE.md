# CLAUDE.md

Guidance for agents working in this repository.

## Read first

1. `CONTEXT.md` — the project glossary. Use its terms exactly; the "Deprecated terms" table lists words not to use.
2. `docs/adr/` — accepted decisions. Do not contradict an Accepted ADR; propose a new ADR instead.
3. `docs/superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md` — the design.
4. `docs/superpowers/plans/` — implementation plans. Follow the roadmap order and its approval gates.

## Hard boundaries

- No patient data anywhere: code, fixtures, tests, logs, or docs. Use synthetic records only.
- The Portal never stores raw Wazuh logs; it stores alert references and its own operational records.
- The Portal reads Wazuh only by pulling from the Wazuh Indexer with a read-only account (ADR 0006).
- No credentials, certificates, private keys, real IP addresses, or real inventories in git. Commit `*.example` files only.
- Missing or stale source data must render as stale/unavailable, never as zero or healthy.
- Notifications (LINE, email) carry only Notification Summary fields.
- Never add restore, immediate-delete, or backup-command controls to the Portal.
- Production changes (Sophos logging, installing or changing the Wazuh VM) need explicit hospital approval; plans and runbooks prepare them, they never perform them.

## Conventions

- Documentation for the hospital team is Thai-first; ADRs, specs, and plans are in English.
- Store times in UTC; render Asia/Bangkok in the UI.
- Plans are written test-first: write the failing test, see it fail, implement, see it pass, commit.
- Work on a branch and open a pull request; CI runs secret scanning and a Markdown link check.

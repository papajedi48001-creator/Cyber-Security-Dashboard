# Manage the HOSxP backup files on GDCC through held lifecycle requests

- Status: Proposed
- Date: 2026-11-27

The hospital administrator asked (2026-11-27) for a Portal page to see and manage the nightly HOSxP backup ZIPs stored on the GDCC VM (ADR 0010). The design lists Backup File Management as a later capability with separate approval; this ADR brings it forward for these files only, in the form the design already sets: a Backup Lifecycle Request with a proposer, an approver, a Backup Deletion Hold, execution evidence and an audit trail. The Portal still has no immediate-delete, restore or backup-command control.

## Decision

- **Status out, by pull.** After each run the GDCC store job writes a status file: file names, sizes, arrival times, whether the checksum sidecar is present (checked on arrival), volume use, the pruning threshold, automatic pruning, corrupt uploads and request outcomes. Nothing from inside a backup. `hosxp_offsite.py sync` on the Portal server fetches it every 5 minutes. The Portal shows it as stale after 30 minutes and as unavailable when missing; it never shows an empty list as healthy.
- **One narrow account.** sync uses an SFTP-only account `portal-ops`, chrooted to `/srv/secure/ops`: it can read `status/status.json` and write into `requests/`, nothing else. It cannot see, read or delete the backups. The Portal web and worker processes never connect to GDCC; they only read the fetched file and write into a local outbox.
- **Requests.** A Security Operator or Administrator proposes destroying one file with a reason. A different Security Administrator approves or rejects it. Approval starts a 24-hour Backup Deletion Hold; the proposer or any Security Administrator can cancel until it ends. The newest files the GDCC job always keeps (2) cannot be requested. Requests need a fresh status. Every step is audited.
- **Execution on GDCC, re-checked.** After the hold the worker writes a destroy instruction (request id, file name, size, not-before time) to the outbox and sync pushes it. The store job acts only on well-formed instructions whose not-before time has passed, never on one of the newest files, and only when the size still matches; each id is handled once. The outcome (`destroyed`, `protected`, `size_mismatch`, `not_found`, `rejected`) comes back in the status file and becomes the request's execution evidence. A request whose file was pruned automatically first is closed.
- Automatic pruning at 85% (ADR 0010) is unchanged and does not wait for a request: the replica keeps priority.

## Consequences

- An attacker who controls the Portal server could push a forged instruction. GDCC still refuses the newest two files, files of another size and anything not named like a backup, and the not-before time is part of the instruction, so the worst case is losing older backups that the hold was meant to protect. The hospital accepts this, or keeps `GDCC_FILES_REQUESTS_OUTBOX` unset and uses the page read-only.
- The status file names backup files and sizes on the Portal server. File names carry only a date; no patient data leaves the encrypted volume.
- Setting up `portal-ops`, its key, and the timers on the GDCC VM and Portal server are production changes that need hospital approval. This repository only prepares them.
- Backup Operator stays unbuilt: Security Operators propose, as they already record Backup Evidence.

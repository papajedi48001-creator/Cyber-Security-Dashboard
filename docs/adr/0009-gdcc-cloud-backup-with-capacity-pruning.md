# Upload encrypted backups to GDCC with capacity-based pruning

- Status: Proposed
- Date: 2026-11-10

The hospital chose GDCC as the off-site cloud for backups (decided 2026-11-10). Two kinds of backup go there:

1. **HOSxP daily backup files.** The hospital's existing HOSxP backup keeps producing its daily files. A HOSxP Uploader on a Backup Gateway picks up each new file at a configured time, encrypts it on the gateway with `age` to a public key, and uploads it to GDCC. It does not run or change the HOSxP backup itself.
2. **The project's own systems** (Wazuh VM, Portal Application Server with Portal MariaDB, TLS Log Relay). A Backup Agent on each host packs, encrypts and uploads a bundle on a schedule.

GDCC storage is an S3-compatible bucket with versioning and a short Object Lock. A Capacity Pruner checks usage against the GDCC quota after each upload window and, when usage passes the high-water mark, deletes the oldest unlocked backups until usage falls to the target. Every upload, pruning decision and deletion is logged and written as a report object in the bucket. The Portal pulls those reports and bucket usage with a read-only account and shows them on the Backup page; it gains no backup, restore or delete control.

## Considered Options

- **Commercial backup product (for example Veeam) to GDCC.** Mature, but adds licences and another server, and HOSxP already produces its own backup files.
- **Deduplicating backup tool (restic or borg).** Efficient, but needs its own repository format for restore and prune, which hides individual HOSxP files from staff and the dashboard.
- **Encrypt and upload each file or bundle as its own object (chosen).** Simple to restore by hand, easy to show per file, and works with narrow credentials.
- **Rely on GDCC server-side encryption only.** Rejected: HOSxP backups contain patient data, so GDCC staff or a stolen GDCC credential must not be able to read them.
- **Let the bucket lifecycle delete by age only.** Rejected as the only control: it cannot react to the quota. It stays as a backstop for the one-year maximum.

## Decision

- **Encryption is client-side** with `age` X25519. Uploading hosts hold only the public recipient key. The private key is the Backup Encryption Key in the Secrets Vault under Dual-Control Key Recovery, with one sealed offline copy that two people open together.
- **Credentials are split by duty.** Uploaders have a write-only account (no list, read or delete). The Capacity Pruner has its own account that may list and delete object versions, kept by a separate service user. The Portal and the Integrity Check have a read-only account. Bucket settings use a GDCC admin account held by Security Administrators with MFA and never stored on a host.
- **Object Lock limits what pruning or ransomware can remove.** Every object is locked in compliance mode for 7 days, so the newest week of backups cannot be deleted by anyone. The pruner also always keeps the newest 7 HOSxP daily files and the newest 3 bundles of each project job, and deletes at most 20% of the bucket's bytes in one run.
- **Pruning is policy-based, not a request.** Thresholds (default: start at 85% of quota, stop at 75%) and the protected minimums are a retention policy approved once by the hospital. The pruner deletes oldest first by upload time. If it cannot reach the target without breaking a protection, it deletes nothing further and reports `capacity_blocked`, which the Portal raises as a P2 incident. This is separate from future Backup File Management, whose manual lifecycle requests still need proposal, approval and a Backup Deletion Hold.
- **Logs and dashboard.** Each run writes JSON-lines logs on its host and a report object (`_reports/...`) containing no file contents and no patient data. The Portal worker pulls reports and bucket usage, records Backup Evidence automatically, and shows usage against quota, upload history, pruning deletions and staleness.
- **Verification.** A weekly Integrity Check downloads the newest object of each job and checks its SHA-256 and `age` header without decrypting. Restore tests decrypt on an isolated Restore Test Host under dual control, at least every 90 days per job.

## Consequences

- Before installation the hospital must confirm with GDCC: S3-compatible API, versioning, Object Lock compliance mode, the allocated quota, data-centre location in Thailand, upload bandwidth and cost. It must approve the Backup Gateway, read-only access to the HOSxP backup folder, the retention policy, and installation as production changes. Without Object Lock, ransomware holding the pruner credential could delete all but the protected minimum; the hospital must then accept that risk or add an offline monthly copy.
- Automatic deletion means old HOSxP backups disappear when space runs short. The hospital must confirm that the protected minimums satisfy its own record-retention obligations; otherwise it must buy more quota rather than lower the minimums.
- Losing both the Secrets Vault and the sealed offline key makes every backup unreadable.
- Upload uses the hospital's internet link; HOSxP files may be large. The upload window and a bandwidth limit are configured so daytime clinical traffic is not affected.
- The Portal Application Server needs outbound HTTPS to GDCC for the read-only pull. Missing or old reports show as stale, never as healthy or as zero usage.

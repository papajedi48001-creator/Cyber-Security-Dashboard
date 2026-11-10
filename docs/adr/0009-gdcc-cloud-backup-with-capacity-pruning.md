# Upload encrypted backups to a GDCC Backup VM with capacity-based pruning

- Status: Proposed
- Date: 2026-11-10

The hospital chose GDCC as the off-site cloud for backups (decided 2026-11-10). A check of the hospital's existing GDCC machine on 2026-11-10 showed that GDCC provides virtual machines, not S3 object storage, and that the existing machine (a CentOS 7 HOSxP restore server with 34 GB free and MySQL reachable from the Internet) is not fit to hold backups. This ADR therefore uses a **dedicated GDCC Backup VM**. If GDCC later offers S3 object storage with Object Lock, the same upload, pruning and reporting rules apply with a bucket in place of the VM's store.

Two kinds of backup go there:

1. **HOSxP daily backup files.** The hospital's existing HOSxP backup keeps producing one ZIP of about 30 GB a day on the hospital NAS. A HOSxP Uploader on a Backup Gateway inside the hospital picks up each new ZIP and its log at a configured time, encrypts them with `age` to a public key, and uploads them. It does not run or change the HOSxP backup itself.
2. **The project's own systems** (Wazuh VM, Portal Application Server with Portal MariaDB, TLS Log Relay). A Backup Agent on each host packs, encrypts and uploads a bundle on a schedule.

## Considered Options

- **Reuse the existing GDCC restore server.** Rejected: 34 GB free, CentOS 7 without security updates, MySQL and other ports open to the Internet, and it may hold restored patient data. Backups would share its risks.
- **GDCC S3 object storage with Object Lock.** Preferred if GDCC offers it, but the check found none.
- **Dedicated GDCC Backup VM with an upload-only account (chosen).** Hospital hosts can add files but never change or delete them; deletion happens only on the VM under the retention policy.
- **Commercial backup product (for example Veeam).** Adds licences and another server, and HOSxP already produces its own files.
- **Deduplicating tool (restic or borg).** Its prune needs delete rights from the client side, which this design removes.

## Decision

- **Backup VM.** A new GDCC VM running a supported Linux (Rocky Linux 9 or AlmaLinux 9) with a separate data disk of at least 500 GB, automatic security updates and time sync. Its firewall allows only SSH, only from the hospital's public address. No database, web server or other service runs on it.
- **Upload-only access.** Each uploading host has its own SSH key, restricted on the VM to `rrsync -wo` (write-only rsync) into `incoming/<job>/`, from the hospital address only. It cannot list, read, change or delete anything.
- **Sealing.** A root service on the VM moves each complete upload (object plus manifest) from `incoming/` to `store/`, makes it owned by root, read-only, and immutable (`chattr +i`). Nothing outside the VM can undo this.
- **Encryption is client-side** with `age` X25519. Hosts hold only the public recipient key. The private key is the Backup Encryption Key in the Secrets Vault under Dual-Control Key Recovery, with one sealed offline copy.
- **Pruning runs on the VM.** After each upload window the Capacity Pruner checks data-disk usage. When usage plus room for the next HOSxP file passes 75% (set by the hospital), it deletes the oldest files until 65%. It never deletes files younger than 7 days or the newest 7 good HOSxP files (set by the hospital), and removes at most 20% of used space in one run; otherwise it reports `capacity_blocked`. No hospital host can delete.
- **Verification runs on the VM.** After sealing, and weekly for the newest object of each job, the VM checks SHA-256 against the manifest and the `age` header without decrypting.
- **Logs and dashboard.** Uploaders and VM services write JSON-lines logs and a report per run into `store/_reports/`. The Portal pulls reports with its own read-only key (`rrsync -ro` on `store/_reports/` only), records Backup Evidence, and shows usage, history, pruning and staleness on the Backup page. The Portal gains no backup, restore or delete control.
- **Restore tests** decrypt on an isolated Restore Test Host under dual control, at least every 90 days per job.

## Consequences

- The hospital must request the Backup VM from GDCC (size, OS, data disk, firewall rule) and approve the Backup Gateway, the NAS read-only account, the retention policy and installation as production changes.
- Someone who gains root on the Backup VM itself could delete backups. The VM exposes only key-based SSH from one address and runs nothing else; GDCC VM snapshots, if offered, add a second layer. This is weaker than S3 Object Lock, which remains the preferred target if GDCC adds it.
- Automatic deletion removes old HOSxP backups when space runs short. The hospital must confirm that keeping at least 7 files meets its record-retention obligations; 7 files are about 224 GB, so the data disk must stay well above 300 GB.
- The uploader flags a HOSxP ZIP much smaller than usual, because the NAS shows days where the HOSxP backup produced a near-empty file; such files do not count toward the protected minimum.
- Upload uses the hospital's Internet link: about 32 GB a day. A bandwidth timetable keeps working-hours traffic unaffected.
- Losing both the Secrets Vault and the sealed offline key makes every backup unreadable.
- The existing GDCC restore server has MySQL, HTTP and SSH open to the Internet. That is outside this ADR but was reported to the hospital as an urgent risk on 2026-11-10.

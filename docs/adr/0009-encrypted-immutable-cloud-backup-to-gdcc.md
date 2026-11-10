# Back up project systems to GDCC as client-encrypted, immutable objects

- Status: Proposed
- Date: 2026-11-10

The project's own systems (Wazuh VM, Portal Application Server with Portal MariaDB, TLS Log Relay) are backed up by a small Backup Agent on each host. The agent packs a bundle, encrypts it on the host with `age` to a public key, keeps a Local Backup Copy inside the hospital, and uploads the encrypted bundle to an S3-compatible GDCC bucket with Object Lock. Each host uploads with its own write-only Backup Upload Account that cannot list, read or delete. Every run writes a Backup Evidence line in the Portal's existing CSV format.

The design answers the open points in the spec's "Backup and disaster recovery" section: what is backed up, how it reaches GDCC, how it is encrypted, and how ransomware on a hospital host is prevented from destroying the off-site copy.

## Considered Options

- **Commercial backup product (for example Veeam) to GDCC.** Mature, but adds licences and another server, and the hospital has not confirmed it owns one for these VMs.
- **Deduplicating backup tool (restic or borg) to GDCC.** Efficient, but pruning needs delete rights on the repository, which conflicts with write-only credentials and Object Lock.
- **Per-run encrypted bundles uploaded as immutable objects (chosen).** Simple, auditable with standard tools, and works with write-only credentials. The data volume is small (configuration and a Portal database dump), so lack of deduplication costs little.
- **Rely on GDCC server-side encryption only.** Rejected: GDCC staff or a stolen GDCC credential could read the bundles.

## Decision

- Encryption is client-side with `age` X25519. Hosts hold only the public recipient key, so a compromised host cannot decrypt earlier backups. The private key is the Backup Encryption Key: it lives in the Secrets Vault under Dual-Control Key Recovery, plus one sealed offline copy that two people must open together, because the vault may itself be lost in a disaster.
- Off-site storage is a GDCC S3-compatible bucket with versioning and Object Lock in compliance mode. Daily bundles are locked for 35 days and expire after 90 days; the first bundle of each month is locked and kept for one year. Expiry is a bucket lifecycle rule, set once by a Security Administrator with the GDCC admin account. No hospital host and no Portal function can delete a backup.
- The Wazuh Indexer snapshot repository for the Log Archive stays a separate bucket without Object Lock, because OpenSearch snapshots must rewrite repository metadata. It is protected by versioning and its own credentials instead.
- A weekly Integrity Check downloads the newest bundle of each job with a read-only account, checks its SHA-256 against the run manifest and checks that it is an `age` file, without decrypting it. Its result is a Backup Evidence line for its own job.
- Restore tests decrypt on an isolated Restore Test Host under dual control, at least every 90 days per job, and are recorded as Restore Verification in the Portal.
- The Portal stays read-only: it imports evidence and never runs, restores or deletes backups.
- Backups of hospital systems outside this project (HOSxP and others) remain with the hospital's existing backup system. They may report evidence to the Portal in the same CSV format.

## Consequences

- Before any installation, the hospital must confirm with GDCC that the service offers S3-compatible object storage with versioning, Object Lock (compliance mode) and lifecycle rules, and must approve the bucket and the agent installation as production changes. If Object Lock is not available, the fallback is a monthly encrypted copy on removable media kept offline in a two-person safe, and this ADR must be revisited.
- Losing both the Secrets Vault and the sealed offline key makes every backup unreadable. Key custody is part of the restore test.
- Bundles are full copies, so storage grows linearly with retention. The capacity baseline estimates the size; the expected total is small (megabytes of configuration and a Portal database dump).
- Credentials stored on hosts can only add objects. A stolen upload credential can fill the bucket or add a newer version over a key, but cannot remove the locked original versions; the Integrity Check and bucket quota alerts expose abuse.
- The Portal shows staleness through the existing Backup Evidence rules when an agent stops reporting; a missing evidence line is never shown as healthy.

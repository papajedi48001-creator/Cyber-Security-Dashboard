# SIEM Foundation and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independently operated Wazuh all-in-one deployment on a dedicated new VM that receives Sophos events through a resilient TLS Log Relay, while the existing FortiSIEM keeps running untouched (ADR 0008).

**Architecture:** Validate the FortiSIEM handover, size and build the Wazuh VM and the TLS Log Relay, then add the relay as a second Sophos Syslog destination so FortiSIEM and Wazuh run in parallel (ADR 0008). Wazuh is the forensic and detection system; it does not host the Portal workflow.

**Tech Stack:** Python 3 standard library for infrastructure tests; dedicated Wazuh VM on the hospital hypervisor; Linux VM for the relay; syslog-ng or rsyslog TLS relay; Wazuh server/indexer/dashboard all-in-one; TLS certificates; GDCC encrypted backup target.

**Spec:** `docs/superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md`

## Global Constraints

- Do not stop, change, export from, or rebuild FortiSIEM or the existing SIEM server. Sophos's existing FortiSIEM Syslog destination stays unchanged.
- The Wazuh VM must meet the measured capacity baseline before installation.
- The TLS Log Relay runs on its own VM, not on the Wazuh VM.
- Sophos Syslog uses TLS to an internal Log Relay; no public log listener is allowed.
- Queryable Wazuh logs target 90 days; encrypted archives target one year.
- Recovery objective for this all-in-one phase is 24 hours, not high availability.
- Store no patient data and never expose credentials in scripts, command arguments, exports, or chat.

## Review Focus

- Loss of Sophos logs while Wazuh is unavailable must be buffered or reported as source-health degradation.
- A spoofed or unapproved Syslog sender must be rejected by relay network and certificate controls.
- Wazuh event loss must be measured; `events_dropped` is unacceptable during validation.
- Backup success must not be presented as restoration verification.
- Cutover rollback removes the second Sophos Syslog destination and must not touch the FortiSIEM feed or silently lose the source-health signal.
- Any period when Wazuh does not receive Sophos events (for example while the second destination is being added) must be measured and recorded, not assumed to be zero.

---

### Task 1: Establish handover and capacity records

**Files:**
- Create: `docs/operations/fortisiem-handover-checklist.md`
- Create: `docs/operations/siem-capacity-baseline.md`
- Create: `docs/operations/fortisiem-acceptance-record.md`
- Keep for a later FortiSIEM retirement only: `docs/operations/fortisiem-evidence-export-record.md`

**Interfaces:**
- Consumes: INET SIEM Handover Package and hospital-approved access.
- Produces: signed acceptance evidence, event-per-second baseline, source inventory, and go/no-go record.

- [ ] **Step 1: Write the acceptance checklist before collecting access**

Include pass/fail rows for administrator login, Sophos receipt, representative detection, source-health failure, backup/restore runbook, reports/rules/parsers export, and read-only access evidence.

- [ ] **Step 2: Execute and record acceptance tests**

Expected: every row contains timestamp, tester, actual result, artifact reference, and blocker; no unverified item is marked passed.

- [ ] **Step 3: Measure capacity**

Record source count, average/peak Sophos EPS, daily log size and projected 90-day storage, read from Sophos or FortiSIEM without changing either. Record the CPU, RAM and disk the hypervisor can give the Wazuh VM, compare against the Wazuh all-in-one minimum, and state the scale-out threshold (EPS and disk %). Confirm Sophos supports a second Syslog destination. Exclude secrets and patient data.

- [ ] **Step 4: Record go/no-go decision**

Expected: a failed handover or insufficient VM capacity blocks the Wazuh VM. Creating the VM and adding the second Sophos destination need explicit hospital approval recorded here.

- [ ] **Step 5: Commit**

```bash
git add docs/operations
git commit -m "docs: record SIEM handover readiness"
```

### Task 2: Build and test the TLS Log Relay

**Files:**
- Create: `infrastructure/log-relay/syslog-ng.conf.template`
- Create: `infrastructure/log-relay/allowed-sources.example`
- Create: `infrastructure/log-relay/render_config.py`
- Create: `infrastructure/log-relay/relay_health.py`
- Create: `infrastructure/log-relay/tests/test_relay.py`
- Create: `infrastructure/log-relay/tests/test_synthetic_tls.py`
- Create: `docs/operations/log-relay-runbook.md`

**Interfaces:**
- Consumes: Sophos source addresses, hospital PKI certificate, destination Wazuh VM endpoint.
- Produces: TLS listener, finite disk buffer, allowlist renderer, and relay health check.

- [ ] **Step 1: Write failing relay tests**

Assert that the template requires TLS, has no wildcard sender policy, uses a finite disk buffer, rejects an unapproved sender, and creates a health signal when forwarding fails.

- [ ] **Step 2: Run tests before implementing the template**

Run: `python3 -m unittest discover -s infrastructure/log-relay/tests`  
Expected: FAIL because the relay templates are absent.

- [ ] **Step 3: Implement templates and runbook**

The runbook must specify certificate rotation, source-allowlist changes, buffer inspection, restart, health validation, and rollback to the last approved logging path.

- [ ] **Step 4: Validate with synthetic TLS Syslog**

Expected: allowed event reaches Wazuh, rejected source is evidenced, and simulated Wazuh outage buffers events and raises relay health. The buffer must be sized to hold Sophos peak EPS for the 24-hour recovery objective. Adding the relay as a second Sophos destination is a production change and waits for hospital approval.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/log-relay docs/operations/log-relay-runbook.md
git commit -m "feat: add TLS log relay foundation"
```

### Task 3: Install Wazuh all-in-one on the Wazuh VM and configure detection

**Files:**
- Create: `infrastructure/wazuh/inventory.example.yml`
- Create: `infrastructure/wazuh/index-lifecycle-policy.example.json`
- Create: `docs/operations/log-archive-runbook.md`
- Create: `infrastructure/wazuh/priority-signals.md`
- Create: `infrastructure/wazuh/tests/test_priority_signals.py`
- Create: `docs/operations/wazuh-all-in-one-runbook.md`
- Create: `docs/operations/wazuh-capacity-check.md`

**Interfaces:**
- Consumes: relay output and capacity baseline.
- Produces: alert categories `blocked_traffic`, `admin_or_login_failure`, `firewall_rule_change`, `vpn_anomaly`, `ips_av_web_event`, and `log_source_health`.

- [ ] **Step 1: Write failing synthetic-event tests**

Include every named alert category, one normal event that must not alert, and one missing-source condition.

- [ ] **Step 2: Run test against the empty Wazuh environment**

Run: `python3 -m unittest discover -s infrastructure/wazuh/tests`  
Expected: FAIL because rules and fixtures are absent.

- [ ] **Step 3: Create the Wazuh VM, install Wazuh, and configure TLS, indices, retention, source inventory, rules, and capacity checks**

Only after Task 1 is go and Task 2's relay passes its tests. Verify that the Wazuh Sophos decoders match the hospital's SFOS log format, and add custom decoders where they do not. Configure a 90-day hot index lifecycle with encrypted snapshots to GDCC for the one-year Log Archive. Create a read-only Wazuh Service Account limited to alert indices for the Portal (ADR 0006); the Portal must not receive a raw-log replica.

- [ ] **Step 4: Run synthetic tests and representative-load checks**

Expected: required categories alert exactly once, normal event does not alert, and Wazuh `events_dropped` is zero.

- [ ] **Step 5: Commit**

```bash
git add infrastructure/wazuh docs/operations
git commit -m "feat: configure Wazuh security detection foundation"
```

### Task 4: Rehearse recovery and execute cutover only with approval

**Files:**
- Create: `docs/operations/siem-backup-recovery-runbook.md`
- Create: `docs/operations/sophos-cutover-checklist.md`
- Create: `docs/operations/sophos-cutover-record.md`
- Create: `docs/operations/tests/validate_cutover_record.py`

**Interfaces:**
- Consumes: accepted Wazuh deployment and encrypted GDCC backup target.
- Produces: 24-hour recovery procedure and evidence-backed cutover record.

- [ ] **Step 1: Write failing record validation**

Reject a record missing rollback, source-health validation, notification evidence, or explicit approval.

- [ ] **Step 2: Run validation before creating the runbook**

Run: `python3 docs/operations/tests/validate_cutover_record.py docs/operations/sophos-cutover-record.md`  
Expected: FAIL because required evidence is absent.

- [ ] **Step 3: Write recovery and cutover runbooks**

Define encrypted backup scope, dual-control key recovery, restore sequence, rollback by removing the second Sophos destination, and health checks. State that job completion is not restore verification.

- [ ] **Step 4: Rehearse with synthetic events**

Expected: recovery documentation, ingestion, priority detection, source health, notification, and rollback are evidenced with actual elapsed time, and any period without Sophos events in Wazuh is recorded.

- [ ] **Step 5: Request production acceptance**

Present the rehearsal evidence and request the hospital's acceptance of Wazuh as the production SIEM. Until accepted, FortiSIEM remains the SIEM of record and the rollback path (remove the second Sophos destination) stays ready.

- [ ] **Step 6: Commit**

```bash
git add docs/operations
git commit -m "docs: add SIEM cutover and recovery evidence"
```


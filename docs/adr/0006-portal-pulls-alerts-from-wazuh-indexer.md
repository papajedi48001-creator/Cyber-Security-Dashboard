# Portal pulls alert summaries from the Wazuh Indexer

- Status: Accepted
- Date: 2026-10-14

The Security Operations Portal reads Wazuh alerts by querying the Wazuh Indexer on a schedule with a dedicated read-only service account. Wazuh does not push alerts into the Portal.

## Considered Options

- Pull: the Portal queries the Indexer for alerts newer than its last checkpoint.
- Push: Wazuh integratord calls a Portal HTTP endpoint for each alert.

## Consequences

- The integration matches the "read-only" boundary: the Portal holds only a read role on alert indices and Wazuh holds no Portal credentials.
- The Portal stores a checkpoint and the time of the last successful query, so a failed or slow query is shown as stale connector data rather than "no alerts".
- Deduplication is by Wazuh alert id, so re-reading an overlapping time window never creates a second incident.
- Alert latency equals the polling interval. P1 notification targets (15 minutes to acknowledge) need an interval of one minute or less.
- No inbound Portal endpoint is exposed for Wazuh, which removes one authenticated surface to defend.

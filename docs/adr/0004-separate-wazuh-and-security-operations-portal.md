# Separate Wazuh forensic investigation from the security operations portal

Wazuh will remain the system for raw log analysis and forensic investigation, while a separate Security Operations Portal will manage daily operations, incidents, audit evidence, backup monitoring, port monitoring, Cloudflare, Duo, and executive reporting. This preserves SIEM depth without forcing hospital workflow and cross-service integrations into Wazuh.

## Consequences

The Portal consumes Wazuh alerts through a read-only integration and stores only its own operational records in a separate MariaDB service. It must not duplicate raw Wazuh logs or expose sensitive technical data through executive views or LINE OA notifications.

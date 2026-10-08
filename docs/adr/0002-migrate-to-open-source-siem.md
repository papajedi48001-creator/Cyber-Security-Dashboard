# Migrate the existing SIEM hardware to an in-house open source SIEM

After completing the FortiSIEM handover acceptance test and preserving required configuration and log evidence, the hospital will build an open source SIEM on the existing server hardware. This gives the hospital independent control of security monitoring and avoids relying on future INET SIEM service or FortiSIEM licensing.

## Considered Options

- Retain FortiSIEM under a hospital-owned license.
- Deploy an open source SIEM on the existing hardware.
- Continue managed SIEM service.

## Consequences

The project must assess hardware capacity, event volume, storage, migration evidence, operational ownership, and a tested rollback path before the existing system is replaced. The old and new SIEM must not share the same production resources during validation without capacity evidence.

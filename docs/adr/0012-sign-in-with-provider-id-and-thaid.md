# Sign in with Provider ID and ThaID, with a break-glass local account

- Status: Proposed
- Date: 2026-11-24

The design started the Portal with local accounts plus TOTP MFA and planned a later move to AD/LDAP. On 2026-11-24 the hospital asked for sign-in through **Provider ID** (Ministry of Public Health) and **ThaID** (Department of Provincial Administration). Administrators should be able to enter each provider's Client ID and Client secret in the web interface.

## Considered Options

- **Keep local accounts with TOTP only.** Already built. But it means one more password per person, and leavers must be removed by hand.
- **Provider ID and ThaID through OpenID Connect / OAuth 2.0 authorization code flow, with an allow-list and a break-glass local account (chosen).**
- **AD/LDAP.** Still possible later, and still a separate approval.

## Decision

- **Two sign-in providers**, each configured in System Settings › การเข้าสู่ระบบ:
  - Client ID and Client secret;
  - authorization and token endpoints, taken from the provider's documentation;
  - scopes and an enabled flag;
  - for Provider ID only, the allowed unit code (hcode).

  The redirect URI is fixed by the Portal and shown to copy into the provider's registration.
- **The flow** is the authorization code flow with `state` and PKCE where the provider supports it. The Portal validates the returned identity, then looks it up in its own allow-list. A successful provider login without an allow-list entry is refused and audited. Provider ID logins outside the allowed hcode are refused.
- **What is stored about each user:**
  - for ThaID, only a keyed hash (HMAC) of the citizen ID, used to match the allow-list. The citizen ID itself is never stored or logged.
  - for Provider ID, the provider's stable subject identifier.
- **Secrets.** The Client secret is encrypted at rest with a key held outside the database (environment or Secrets Vault). It is write-only in the interface: after saving it shows "ตั้งค่าแล้ว" and a timestamp, never the value. Every change is audited without the value.
- **Before a provider can be enabled**, the interface checks that:
  - the Client ID and Client secret are present;
  - the endpoints use https;
  - the hcode is set, for Provider ID;
  - a connection test has passed;
  - at least one Security Administrator can sign in through that provider.

  The last enabled sign-in method cannot be disabled.
- **Break-glass account.** One local Security Administrator account with password and TOTP stays for first-time setup and for provider outages. Each use alerts every Security Administrator and is audited.
- **MFA requirement.** The design requires MFA for administrators and operators. The hospital must confirm that each provider's sign-in meets that requirement. If it does not, the Portal adds its own TOTP step after the provider login.
- **Network restriction is unchanged:** the Portal is still reachable only from the Management VLAN or an MFA VPN.

## Consequences

- The Portal must reach each provider's endpoints over HTTPS, so the outbound firewall needs rules for those hosts.
- Each provider requires the hospital to register the application and receive credentials. Exact endpoints and claims come from each provider's current documentation during implementation; the prototype does not assume them.
- Users are still created in the Portal by an administrator. Provider identity proves who someone is; the allow-list decides whether they may enter and with which role.
- This replaces "local accounts with a later AD/LDAP transition" as the primary path. Local accounts remain only as break-glass.

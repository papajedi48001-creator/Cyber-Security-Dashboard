# Add Provider ID login to the Portal alongside Local Accounts

- Status: Accepted
- Date: 2026-10-14
- Amends: the Portal Identity Transition in the [design](../superpowers/specs/2026-10-08-waritchaphum-cyber-security-dashboard-design.md) (Network and access controls)

The Portal will let a Security Administrator, Security Operator or Executive Viewer sign in with the Ministry of Public Health Provider ID (Health ID login, then the Provider ID profile) in addition to the Local Account. The hospital chose this on 2026-10-14. AD/LDAP stays a deferred option; this decision does not remove it.

Provider ID proves that a person is registered health personnel. It does not prove that the person is a member of the hospital's security team, so it only identifies a Portal User that a Security Administrator has already created and linked. Roles, MFA and session rules stay in the Portal.

## Considered Options

- Keep Local Accounts only until AD/LDAP (the original Portal Identity Transition).
- Provider ID as the only login.
- Provider ID as an additional login that maps to existing Portal Users, with Local Accounts kept as break-glass.

## Decision details

1. **No automatic accounts.** A Provider ID login succeeds only when its Provider ID is linked to an active Portal User. A Security Administrator creates the link, and the Portal audits linking and unlinking. A Portal User has at most one Provider ID and a Provider ID belongs to at most one Portal User.
2. **Hospital check.** The Provider ID profile must list the hospital's health facility code (hcode); otherwise the login fails.
3. **Portal MFA still applies.** After Provider ID, the user enters the Portal TOTP code before a session is created, until the hospital confirms that Health ID enforces MFA on every login. The pending step expires after five minutes, is single-use, and a wrong code counts toward the Local Account lockout.
4. **Minimal identity data.** The Portal stores only the issuer and the Provider ID of a link. It does not store national ID numbers, Health ID or Provider ID tokens, or the raw profile, and does not write them to logs or audit metadata.
5. **OAuth hygiene.** Authorization code flow with a random `state` bound to the browser by a short-lived `__Host-` cookie, PKCE where the provider supports it, an exact registered redirect URI, and a server-side code exchange with a short timeout.
6. **Break-glass.** Local Account login (password plus TOTP) stays available. When the provider is unreachable the Portal says Provider ID is unavailable rather than failing silently.
7. **Off by default.** Provider ID login appears only when the Portal is configured with a Provider ID client. The HTTP adapter for the real Health ID and Provider ID endpoints is written against the documentation the hospital receives when it registers its client, not guessed.

## Consequences

- The Portal Application Server needs outbound HTTPS to the Health ID and Provider ID endpoints, and staff browsers need to reach the Health ID login page. Opening that firewall path is a production change that needs hospital approval.
- The hospital must register a Provider ID client with the Ministry of Public Health and give the Portal its client credentials through the secrets mechanism, never in git.
- Management-Only Access still applies: the callback returns to the Portal's internal hostname through the browser, so the Portal is not exposed to the Internet.
- An outage of Health ID or Provider ID does not block incident work, because Local Account login remains.

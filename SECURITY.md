# Security Policy

## Status

provin.auth is the **proof-of-concept** auth stack of the provin / dPLaaX
project: composition-root scaffolds for a DID-grant auth provider and a
policy verifier. It is not a hardened production system. The shipping grant
contract and its accepted limitations (the relationship-blind
`LEGACY_DID_LOGIN@1` default; the OWNER profile built but fail-closed
unwired; no revocation check at token issuance) are stated in the
[README](README.md) — a report that one of those *documented* limits exists
is expected behavior, but a way to *exceed* what the documentation promises
is exactly what we want to hear about.

## Reporting a vulnerability

**Please do not open a public issue for a suspected vulnerability.** Public
disclosure of an unpatched flaw puts every deployment at risk.

Report privately through **GitHub Private Vulnerability Reporting** on this
repository: the **Security** tab → **Report a vulnerability**. If the
Security tab is unavailable, email <yoshi@1o1.co.jp> instead.

Please include, to the extent you can:

- affected version or commit (or the GHCR image tag/digest),
- impact (what an attacker gains),
- reproduction steps or a proof of concept,
- any embargo/disclosure timing you would like us to honor.

We do **not** commit to an acknowledgement or remediation SLA, and we do not
operate a bug-bounty program. We will engage on the private advisory and
coordinate disclosure with you.

## Supported versions

While the project is `0.x`, only the latest published minor line receives
security assessment and fixes.

| Version | Status |
| --- | --- |
| `0.2.x` | Supported (current line; GHCR `v0.2` images). |
| earlier | Unsupported. |

# Changelog

All notable changes to this repository are documented here. The format is based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is `0.x`, the public API (the `@provin-line/auth-provider-did`
module surface and the DID grant contract) may still change between minor
releases.

## [0.2.0] - 2026-07-24

Reference policy-verifier authorization surface for the separated
network/pipeline topology (lock-step with provin.oss's `cmd/network` +
`cmd/pipeline` recomposition — PR2 evidence-wire and the tlog-mirror surface).

### Added

- Reference policy verifier: declare the evidence-write and transparency-log
  resource/actions the separated data plane exercises but `v0.1.0` did not
  authorize — `chain`/`report-health` (publisher emit-health reporting),
  `payloads`/`retain` (by-reference payload deposit), `audit`/`register`
  (evidence registration), and `tlog`/`mirror` (custody-log mirroring). The
  `v0.1.0` image predated these wire calls and `403`d them with
  `undeclared_resource_action`, blocking the provin.oss quickstart's separated
  topology from reaching a `VERIFIED` verdict.

## [0.1.0] - 2026-07-12

Initial internal release — pinned for internal (private) deployment and soak.

### Added

- `@provin-line/auth-provider-did`: a DID grant-type provider for the o3co auth
  stack (`@o3co/auth-provider-core`). It authenticates a client by a
  counterparty-signed DID proof and issues a token for it.
- The grant is registered under the extension grant-type URI
  `https://dplaax.dev/oauth/grant-type/did` (RFC 6749 §4.5 extension grant;
  domain ownership = namespace authority). The identifier is compared
  byte-for-byte, never dereferenced.
- A reference policy verifier and auth provider, published as private GHCR
  container images (`ghcr.io/provin-line/auth-policy-verifier`,
  `ghcr.io/provin-line/auth-auth-provider`) by `publish-images.yml` on `v*`
  tags, consumed by the provin.oss quickstart via `AUTH_REF`.

[0.2.0]: https://github.com/provin-line/auth/releases/tag/v0.2.0
[0.1.0]: https://github.com/provin-line/auth/releases/tag/v0.1.0

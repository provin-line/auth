# @provin-line/auth-dplaax-registry

Provides [`@provin-line/auth-did-grant`](../did-grant/README.md)'s `didDocuments`: it resolves did:dplaax owner DIDs against a DID registry, through auth.provider's `outbound`.

## What it does

- A DID resolves at `<url>/did/<accountType>/<accountId>/did.json`. Only owner DIDs resolve: the grant authenticates owners, and pipeline and process DIDs belong to the Signer API.
- The DID's registry segment must be the URL's host, or a name `allowed-registries` lists, in any case.
- The resolution carries the bytes served, their `sha256:` digest, the origin they came from (`registry:<origin>#<digest>` as the snapshot reference) and the time, on the kernel's clock. The did-grant writes these into its token's claims.
- The document is decoded strictly (rule `canon.strict-decode`): invalid UTF-8, a duplicate key, trailing data and an unpaired surrogate escape are refused, and an integer beyond 2^53 is kept exactly. It must be a JSON object with a string `id`, and that `id` must be the DID, byte for byte.
- The URL is built from the DID's segments, which the did:dplaax grammar limits to `[A-Za-z0-9._-]` and never a dot-only segment, so no separator, query or traversal reaches it.

Failures follow rule `auth.resolve.failure-mapping`:

| Outcome | When |
| --- | --- |
| rejected (the grant answers `400 invalid_grant` with the reason) | Not a did:dplaax owner DID; a registry name not allowed; HTTP 404 or another 4xx; bytes that are no document for the DID. |
| `Unavailable` (the grant answers `503`) | HTTP 5xx; no usable answer in time; an answer over `max-document-size` (outbound stops it before its status is read, so a large 5xx and a large document look alike); a destination outbound refuses, a redirect included (outbound never follows one); outbound's concurrency limit reached. |

## Reaching the registry

The URL is the operator's own (`Narrower.internal`). outbound's destination policy decides how it is reached:

- **https**: list the host in `outbound.internal-hosts` when it resolves to a private address, and make its CA trusted by Node (`NODE_EXTRA_CA_CERTS`).
- **plain http**: name its `host:port` in `outbound.plain-internal`. It is reached only at private addresses, and what travels is in the clear: use it only on a network trusted against reading and changing it.

Either way the host must pass `outbound.allow` (or `outbound.allow-any-public`). Boot is refused, at `dplaax-registry.url`, when the policy refuses the URL, with outbound's words for what to set.

outbound's limits bound every resolution, and this section can only narrow them: `outbound.timeout` (5s), `outbound.max-response-size` (64KiB; a larger `max-document-size` is cut to it) and `outbound.max-concurrent` (16, shared by every outbound caller). A request past the concurrency limit is refused at once (503) rather than queued. Resolution runs before any signature is checked, so a public client can cause one.

## Section

```hocon
dplaax-registry {
  url = "http://registry.internal:8443"
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `url` | required | The registry's base URL, https or http, no query. A path is kept; a trailing slash is not. |
| `allowed-registries` | `[]` | Registry names a DID may carry beyond `url`'s host, for DIDs kept under an earlier registry's name. |
| `timeout` | `5s` | How long a resolution may take, `1ms` to `1m`. |
| `max-document-size` | `64KiB` | The largest document taken, `1B` to `16MiB`, within `outbound.max-response-size`. |

## Package

Export: `./module` (default export), named `dplaax-registry`, replica-safe: it keeps nothing between requests. auth.provider's packages, `@provin-line/auth-did-grant` and zod are peers: the kernel finds contracts by the object itself.

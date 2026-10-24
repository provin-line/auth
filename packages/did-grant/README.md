# @provin-line/auth-did-grant

The dPLaaX DID grant as an [auth.provider](https://github.com/o3co/auth.provider) 0.18 module. A client presents a DID and a message the DID signed; the module resolves the DID's document, verifies the signature with the key it lists, and issues an access token for the DID.

It replaces `@provin-line/auth-provider-did`, the auth.provider 0.15 composition, which goes once nothing uses it.

## Grant type

```text
https://dplaax.dev/oauth/grant-type/did
```

RFC 6749 §4.5 names an extension grant by an absolute URI. The token endpoint compares it byte for byte; it is never dereferenced.

## Package

| Export | What it holds |
| --- | --- |
| `.` | The contract: `didDocuments`, `spentNonces` (with `spentNoncesNeeds`), `signatureAlgorithms`, and the types they speak. |
| `./module` | The module (default export), named `did-grant`, with the section `did-grant`. |
| `./testing` | `spentNoncesContract`, the suite an implementation of `spentNonces` passes. |

auth.provider's packages and zod are peers: the kernel finds contracts by the object itself, so the app must hold one copy of each. `@noble/ed25519` is an optional peer, needed for `ed25519_raw` and `ed25519_prehash` only.

Not published to npm: depend on it as a git-subdirectory reference at a release tag (`github:provin-line/auth#<tag>&path:/packages/did-grant`).

## Composing it

The module contributes the grant to `grants` and takes:

- `didDocuments`: resolves a DID to its document and the provenance of the bytes served. Provided by the dPLaaX registry module.
- `spentNonces`: keeps the nonces of messages already used. Wired by the dPLaaX registry module on the kernel's `store`; it needs `spentNoncesNeeds`.
- `issuer`, `tokenEndpointLocation` and the client allowance, from auth.provider.

A client may use the grant once its `client-allowance` lists the grant type. The scope is the `scope` parameter within the client's allowance, or its default scopes; none is issued when both are empty. The audience is the one the message signed, when the client may be issued it, and otherwise the allowance's.

## Section

```hocon
did-grant {
  revocation-latency-bound = 15m
  access-token-lifetime = 10m
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `supported-algorithms` | `["ed25519_raw"]` | The algorithms a request may use: `ed25519_raw`, `ed25519_prehash`, `ed25519_jws`, `es256_jws`, `es256k_jws`, or one contributed at `signatureAlgorithms`. |
| `message-max-age` | `5m` | How far a message's timestamp may be from this host's clock, `1s` to `1d`. |
| `auth-contract` | `LEGACY_DID_LOGIN@1` | The dplaax.spec auth contract: `LEGACY_DID_LOGIN@1`, `OWNER_AUTHENTICATION_LOGIN@1` or `OWNER_ASSERTION_CONTROL_LOGIN@1`. |
| `owner-migration-ratified` | `false` | The operator's opt-in an OWNER contract requires (rule `auth.migration.enable-gate`). |
| `revocation-latency-bound` | required | The longest a token may outlive a revocation (rule `auth.token.lifetime-bound`), `1s` to `1d`. |
| `legacy-max-ttl` | `15m` | The longest lifetime of a `LEGACY_DID_LOGIN@1` token (rule `auth.legacy.did-login`). |
| `access-token-lifetime` | required | The lifetime of the tokens this grant issues, `1s` to `1d`: at most `revocation-latency-bound`, and for LEGACY at most `legacy-max-ttl`. |

Boot is refused for a lifetime out of those bounds, an unknown algorithm, an OWNER contract that is not ratified, names an algorithm without a JWS protected header, or runs where the token endpoint has no public location, and a contributed algorithm that takes a built-in name.

## Requests

Form or JSON, every parameter a string: `grant_type`, `did`, optionally `scope`, and the signed message:

- `ed25519_raw`: `message` (JSON text) and `signature` (standard base64 of the raw Ed25519 signature over its bytes); `prehash=sha256` selects `ed25519_prehash`.
- JWS algorithms: `jws`, a compact JWS whose protected header's `alg` selects the algorithm.
- `algorithm` names one explicitly, which is how a contributed algorithm is chosen.

The message holds `did`, `timestamp` (RFC 3339), `nonce` and optionally `audience`. Under an OWNER contract it is a `login-transcript-v1`: its issuer, token endpoint, audience, contract and DIDs must be this deployment's, and its `verification_method` must name the JWS header's `kid` and a key listed under the contract's relationship (`authentication` or `assertionMethod`).

A message is used once: its nonce is spent before the client's allowance is asked, and kept until the message's window closes. A refused OWNER transcript leaves it unspent.

| Answer | When |
| --- | --- |
| `400 invalid_request` | `did` missing; no algorithm can be told, or one not supported; message without nonce or timestamp, or out of its window; nonce already used; an audience the client may not be issued. |
| `400 invalid_grant` | The resolver rejected the DID (its reason is told); no usable key; the signature does not verify; an OWNER transcript refused. Never `401`, which would ask the client to authenticate. |
| `400 invalid_scope` | A scope outside the client's allowance. |
| `503 temporarily_unavailable` | The resolver or the nonce store cannot tell (`Unavailable`). |

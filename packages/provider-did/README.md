# @provin-line/auth-provider-did

DID (Decentralized Identifier) authentication grant for [dplaax.auth](../../README.md).

Adds the DID OAuth 2.0 grant type. Clients present a DID and a signed message; the server verifies the signature using the public key resolved from the DID document. Ships with five built-in signature algorithms (`ed25519_raw`, `ed25519_prehash`, `ed25519_jws`, `es256_jws`, `es256k_jws`); custom algorithms can be registered via `VerifierRegistry`.

## Grant Type URI

The DID grant is registered under the fixed grant-type URI:

```text
https://dplaax.dev/oauth/grant-type/did
```

Clients must send this exact string as the `grant_type` parameter. The
bare string `"did"` is not supported.

Note: the grant is registered in the `GrantRegistry` under the full URI
`https://dplaax.dev/oauth/grant-type/did`; the bare string `"did"` is not
registered and returns `unsupported_grant_type`. The **config key**
remains `oauth.grants.did` (method-name based, not URI based, because
HOCON keys with colons require quoting). References to `"did"` in the
API reference below refer to that config key only, not to a wire value
or registry identifier.

### Why an `https://dplaax.dev/...` URI?

RFC 6749 §4.5 identifies extension grants by an absolute URI. An
`https://` URI under a domain the protocol definer controls needs no
IANA registration — domain ownership IS the namespace authority (an
earlier iteration used `urn:dplaax:...`, but a formal `urn:` namespace
ID requires IANA registration under RFC 8141, which an https URI
sidesteps entirely). The URI is an identifier compared byte-for-byte by
the token endpoint; it is never dereferenced at runtime, though the
dPLaaX project will host a human-readable description of the grant at
that address.

Consumer deployments that extend the wire protocol (e.g. to embed a
Verifiable Presentation) should define a new grant under a domain they
control (e.g. `https://example.com/oauth/grant-type/did-vp`) rather
than overriding this one.

## Install

Not yet published to npm — consume it as a git-subdirectory dependency
(pnpm 10.x syntax; see [create-app.md § 3.3](https://github.com/provin-line/auth/blob/develop/docs/create-app.md)):

```jsonc
// package.json
"@provin-line/auth-provider-did":
  "github:provin-line/auth#<release-tag>&path:/packages/provider-did"
```

Optional peer dependency (required for the `ed25519_raw` and `ed25519_prehash` algorithms; not needed for the JWS algorithms):

```bash
npm install @noble/ed25519
```

## P0 Auth Contract

This package mints tokens under a P0 auth contract (dplaax.spec). Full
detail — the six token claims, config keys, resolver failure semantics, and
liveness posture — lives in [the repo README's "P0 Auth Contract"
section](../../README.md#p0-auth-contract); this is the short version.

`authContract` (`oauth.grants.did.authContract`) selects one of three
contract ids:

- **`LEGACY_DID_LOGIN@1`** (default) — the pre-existing, relationship-blind
  message shape. Active today; capped by `legacyMaxTtlSec`.
- **`OWNER_AUTHENTICATION_LOGIN@1`** / **`OWNER_ASSERTION_CONTROL_LOGIN@1`** —
  transcript-bearing contracts, active and wired into the grant's request
  handler. The signed request payload must be a versioned login transcript
  (`login-transcript-v1`, `validateOwnerLogin` in `transcript.mts`): all ten
  transcript fields required, the JWS header `kid` / transcript
  `verification_method` / resolver-selected method id must three-way match,
  and the method must be *string*-referenced in the required DID Document
  relationship (`authentication` for `OWNER_AUTHENTICATION_LOGIN@1`,
  `assertionMethod` for `OWNER_ASSERTION_CONTROL_LOGIN@1`). `audience` is
  required (one of the transcript's ten mandatory fields), unlike LEGACY.
  Requires `ownerMigrationRatified: true` and `tokenEndpoint` configured.

## Public API

### `oauthDidModule`

```typescript
function oauthDidModule(options: DidModuleOptions): Module;
```

Factory that returns a module (name: `"oauth-did"`). Contributes the DID grant under the grant-type URI `https://dplaax.dev/oauth/grant-type/did` (note: `oauth.grants.did` is the **config key**, not the wire value or registry key).

Per the v0.5 manifest model, registration is declarative: include this module in `createApp`'s `modules` array to enable DID authentication. The `oauth.grants.did.enabled` config field is accepted for HOCON-config backward compatibility but ignored at runtime — composition decides whether the grant is contributed.

`DidModuleOptions` must supply a DID document resolver in one of two forms, plus optional `verifierRegistry` / `nonceStore` overrides:

```typescript
type DidModuleOptions =
  | { resolver: DidDocumentResolver; verifierRegistry?: VerifierRegistry; nonceStore?: NonceStore }
  | {
      resolverFactory: (config: Record<string, unknown>) => DidDocumentResolver;
      verifierRegistry?: VerifierRegistry;
      nonceStore?: NonceStore;
    };
```

- **`resolver`** — a pre-built resolver instance
- **`resolverFactory`** — a factory called with the DID grant config section at init time
- **`verifierRegistry`** — optional `VerifierRegistry` for registering additional algorithms beyond the built-ins; defaults to a registry pre-populated with the five built-ins
- **`nonceStore`** — optional `NonceStore` for replay protection; defaults to an in-memory store (see "Nonce Replay Protection" below)

---

### `createDidGrant`

```typescript
type DidGrantOptions = {
  resolver: DidDocumentResolver;
  verifierRegistry?: VerifierRegistry;
  nonceStore?: NonceStore;
};

function createDidGrant(
  deps: GrantDependencies,
  options: DidGrantOptions,
): GrantHandler;
```

Factory that creates the DID grant handler (registered under the grant-type URI `https://dplaax.dev/oauth/grant-type/did`). The handler expects the following request body fields:

| Field                 | Description                                        |
|-----------------------|----------------------------------------------------|
| `did`                 | The DID of the authenticating party                |
| _(algorithm-specific)_ | Additional fields depend on the configured algorithm |

The set of accepted algorithms is configured via `config.oauth.grants.did.supportedAlgorithms` (a string array). For backward compatibility the legacy single-value `algorithm` field is still accepted as an alias when `supportedAlgorithms` is absent. Built-in algorithms:

| Algorithm        | Description                                                              |
|------------------|--------------------------------------------------------------------------|
| `ed25519_raw`    | Raw Ed25519 signature (default). Requires `@noble/ed25519`.              |
| `ed25519_prehash`| Pre-hashed (SHA-256) Ed25519 signature. Requires `@noble/ed25519`.       |
| `ed25519_jws`    | Ed25519 wrapped in a JWS envelope                                        |
| `es256_jws`      | ES256 (P-256) JWS                                                        |
| `es256k_jws`     | ES256K (secp256k1) JWS                                                   |

---

### `didConfigSchema`

```typescript
const didConfigSchema: z.ZodObject<{
  oauth: {
    grants: {
      did: {
        /** @deprecated Composition decides via the modules array; ignored at runtime. */
        enabled?: boolean;
        /** @deprecated Use supportedAlgorithms instead. Kept for backward compatibility. */
        algorithm?: string;
        supportedAlgorithms: string[];      // default: ["ed25519_raw"]
        messageMaxAgeSec: number;           // default: 300
        allowedAudiences: string[];         // REQUIRED, non-empty — NO default (fail closed)
        authContract: AuthContractId;       // default: "LEGACY_DID_LOGIN@1"
        ownerMigrationRatified: boolean;    // default: false
        revocationLatencyBoundSec: number;  // REQUIRED, positive integer — NO default (fail closed)
        legacyMaxTtlSec: number;            // default: 900
        tokenEndpoint?: string;             // required when authContract is OWNER_*
        resolver?: {                        // resource-floor bounds passthrough; this package
          timeoutMs?: number;                // only defines the shape, a resolverFactory (e.g.
          maxBodyBytes?: number;              // DplaaxDidResolver) supplies its own defaults
          maxConcurrent?: number;
        };
      };
    };
  };
}>;
```

Zod schema for the DID grant configuration slice. The shape mirrors the runtime read path (`config.oauth.grants.did.*`) so that `defineModule`'s `configSchema` slot composes correctly against `CoreConfigSchema` and the declared defaults reach the grant factory at boot. `supportedAlgorithms` is the primary field for selecting accepted algorithms; the legacy single-value `algorithm` is still accepted as a backward-compatible alias.

**`allowedAudiences` and `revocationLatencyBoundSec` are required, with no
default** — an empty/absent audience allowlist used to mean "accept any
audience" (a fail-open default); both fields now fail closed at parse time,
and `createDidGrant` itself re-asserts them (so a hand-built config that
skips `didConfigSchema.parse` doesn't bypass the check either). `expiresIn`
(from the sibling `oauth.accessToken` slice) must stay ≤
`revocationLatencyBoundSec` always, and ≤ `legacyMaxTtlSec` specifically
when `authContract` is `LEGACY_DID_LOGIN@1` — both checked as boot-time
asserts in `createDidGrant`, since this schema can't see the sibling slice.
`authContract` / `ownerMigrationRatified` gate the OWNER contracts at the
schema level (`auth.migration.enable-gate`), but selecting an OWNER
`authContract` is refused unconditionally by `createDidGrant` regardless of
that gate — see "P0 Auth Contract" above.

---

### `createVerifier`

```typescript
function createVerifier(
  algorithm: Algorithm,
  pathResolver?: PathResolver,
): Promise<SignatureVerifier>;
```

Creates a `SignatureVerifier` for the given algorithm. `pathResolver` is used to locate key material on disk (required for some algorithms).

---

### `SignatureVerifier` (interface)

```typescript
interface SignatureVerifier {
  verify(ctx: VerificationContext): Promise<VerificationResult>;
}
```

---

### `VerificationContext` (interface)

```typescript
interface VerificationContext {
  body: Record<string, unknown>;
  did: string;
  resolvedKey: ExtractedKey;
}
```

`resolvedKey` is produced by `extractVerificationKey(didDocument, did)` — see the `ExtractedKey` export.

---

### `VerificationResult` (type)

```typescript
type VerificationResult =
  | { valid: true; subject: string; audience?: string; parsedMessage: ParsedMessage }
  | { valid: false; error: string; errorDescription: string };
```

Check `valid` before accessing `subject` or `parsedMessage`.

---

### `ParsedMessage` (interface)

```typescript
interface ParsedMessage {
  did: string;
  timestamp: string;
  nonce: string;
  audience?: string;
  /** Signed payload's `verification_method` member, if present. Not enforced here. */
  verificationMethod?: string;
  /** JWS protected header's `kid` member, if present. Not enforced here. */
  headerKid?: string;
}
```

`verificationMethod` / `headerKid` are surfaced only by the JWS-based
verifiers (`ed25519_jws`, `es256_jws`, `es256k_jws`) — the raw Ed25519
verifiers have no header/kid concept, so they can never satisfy the OWNER
path's three-way match (see below). On the LEGACY path neither field is
enforced against the resolved key. On the OWNER path, `verificationMethod`
and `headerKid` (via `parsedMessage`) feed the three-way match enforced by
`validateOwnerLogin` — see "P0 Auth Contract" above.

---

### `Algorithm` (type)

```typescript
type Algorithm = string;
```

`Algorithm` is intentionally an open `string` so that consumers can register custom algorithms via `VerifierRegistry`. Built-in identifiers shipped by this package: `ed25519_raw`, `ed25519_prehash`, `ed25519_jws`, `es256_jws`, `es256k_jws`.

## Usage Example

```typescript
import {
  createApp,
  createKeyStoreFromConfig,
  defineModule,
} from "@o3co/auth-provider-core";
import { oauthDidModule } from "@provin-line/auth-provider-did";

// `oauthDidModule` declares `requires: ["config", "keyStore", "pathResolver"]`.
// `config` and `pathResolver` flow through `bootstrapComponents`; `keyStore`
// must be supplied by another module — the smallest form is a one-line
// `defineModule` that constructs it from your config and exposes it.
const keyStore = await createKeyStoreFromConfig(config.oauth.jwt);
const keyStoreModule = defineModule({
  name: "app:key-store",
  provides: { keyStore: () => keyStore },
});

// config.oauth.grants.did — REQUIRED, no default (fail closed):
//   allowedAudiences: non-empty string[]
//   revocationLatencyBoundSec: positive integer, >= oauth.accessToken.expiresIn
// Fields with defaults:
//   supportedAlgorithms = ["ed25519_raw"]
//   messageMaxAgeSec = 300
//   legacyMaxTtlSec = 900
//   authContract = "LEGACY_DID_LOGIN@1"
//   ownerMigrationRatified = false

const handle = await createApp({
  modules: [
    oauthDidModule({ resolver: myResolver }),
    keyStoreModule,
    // …other modules
  ],
  bootstrapComponents: { config, pathResolver },
});
// handle.dispose() releases resources on shutdown
```

### Verifying a signature directly

```typescript
import {
  createVerifier,
  extractVerificationKey,
} from "@provin-line/auth-provider-did";

const verifier = await createVerifier("ed25519_jws");
const resolvedKey = await extractVerificationKey(didDocument, did);
const result = await verifier.verify({ did, body: requestBody, resolvedKey });

if (result.valid) {
  console.log("authenticated subject:", result.subject);
} else {
  console.error(result.error, result.errorDescription);
}
```

## Production Considerations

### Nonce Replay Protection

Replay protection is pluggable via the `NonceStore` interface:

```typescript
interface NonceStore {
  /** Returns `false` when `nonce` is a replay within its freshness window. */
  consume(nonce: string, expiresAtMs: number): Promise<boolean>;
}
```

Both `oauthDidModule` and `createDidGrant` accept an optional `nonceStore`.
When omitted, an in-memory default (`InMemoryNonceStore`) is used, which has
two limitations:

1. **Process restarts**: Stored nonces are lost on restart, creating a replay window of `messageMaxAgeSec` (default: 300 seconds)
2. **Multi-instance deployments**: Each instance maintains its own in-memory store, so a nonce used on one instance can be replayed on another

For production deployments requiring stronger replay protection, inject a
shared-store implementation of `NonceStore` (e.g. Redis-backed) via the
`nonceStore` option.

## See Also

- [`@o3co/auth-provider-core`](https://www.npmjs.com/package/@o3co/auth-provider-core) — shared types (`Module`, `defineModule`, `GrantHandler`, `GrantDependencies`)

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

```bash
npm install @provin-line/auth-provider-did
```

Optional peer dependency (required for the `ed25519_raw` and `ed25519_prehash` algorithms; not needed for the JWS algorithms):

```bash
npm install @noble/ed25519
```

## Public API

### `oauthDidModule`

```typescript
function oauthDidModule(options: DidModuleOptions): Module;
```

Factory that returns a module (name: `"oauth-did"`). Contributes the DID grant under the grant-type URI `https://dplaax.dev/oauth/grant-type/did` (note: `oauth.grants.did` is the **config key**, not the wire value or registry key).

Per the v0.5 manifest model, registration is declarative: include this module in `createApp`'s `modules` array to enable DID authentication. The `oauth.grants.did.enabled` config field is accepted for HOCON-config backward compatibility but ignored at runtime — composition decides whether the grant is contributed.

`DidModuleOptions` must supply a DID document resolver in one of two forms, plus an optional `verifierRegistry` for injecting custom algorithms:

```typescript
type DidModuleOptions =
  | { resolver: DidDocumentResolver; verifierRegistry?: VerifierRegistry }
  | {
      resolverFactory: (config: Record<string, unknown>) => DidDocumentResolver;
      verifierRegistry?: VerifierRegistry;
    };
```

- **`resolver`** — a pre-built resolver instance
- **`resolverFactory`** — a factory called with the DID grant config section at init time
- **`verifierRegistry`** — optional `VerifierRegistry` for registering additional algorithms beyond the built-ins; defaults to a registry pre-populated with the five built-ins

---

### `createDidGrant`

```typescript
type DidGrantOptions = {
  resolver: DidDocumentResolver;
  verifierRegistry?: VerifierRegistry;
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
        supportedAlgorithms: string[]; // default: ["ed25519_raw"]
        messageMaxAgeSec: number;      // default: 300
        allowedAudiences: string[];    // default: []
      };
    };
  };
}>;
```

Zod schema for the DID grant configuration slice. The shape mirrors the runtime read path (`config.oauth.grants.did.*`) so that `defineModule`'s `configSchema` slot composes correctly against `CoreConfigSchema` and the declared defaults reach the grant factory at boot. `supportedAlgorithms` is the primary field for selecting accepted algorithms; the legacy single-value `algorithm` is still accepted as a backward-compatible alias.

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
}
```

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

// Optional config slice (all fields have sensible defaults):
//   config.oauth.grants.did.supportedAlgorithms = ["ed25519_raw"]
//   config.oauth.grants.did.messageMaxAgeSec = 300
//   config.oauth.grants.did.allowedAudiences = []

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

The DID grant uses an in-memory store for nonce replay protection. This has two limitations:

1. **Process restarts**: Stored nonces are lost on restart, creating a replay window of `messageMaxAgeSec` (default: 300 seconds)
2. **Multi-instance deployments**: Each instance maintains its own nonce store, so a nonce used on one instance can be replayed on another

For production deployments requiring stronger replay protection, an external nonce store (e.g., Redis) is recommended. A `NonceStore` interface for pluggable backends is planned for a future release.

## See Also

- [`@o3co/auth-provider-core`](https://www.npmjs.com/package/@o3co/auth-provider-core) — shared types (`Module`, `defineModule`, `GrantHandler`, `GrantDependencies`)

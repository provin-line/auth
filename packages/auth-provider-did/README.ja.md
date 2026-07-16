# @provin-line/auth-provider-did

[dplaax.auth](../../README.md) 向け DID (Decentralized Identifier) 認証 grant。

OAuth 2.0 の `"did"` grant type を追加する。クライアントは DID と署名済みメッセージを提示し、サーバーは DID ドキュメントから解決した公開鍵で署名を検証する。built-in で 5 種類の署名アルゴリズム（`ed25519_raw`、`ed25519_prehash`、`ed25519_jws`、`es256_jws`、`es256k_jws`）をサポートし、`VerifierRegistry` 経由でカスタムアルゴリズムを追加登録できる。

## Grant Type URI

DID grant は固定の grant-type URI で登録されている:

```text
https://dplaax.dev/oauth/grant-type/did
```

クライアントはこの文字列を `grant_type` パラメータとして送信しなければならない。
短縮形の `"did"` はワイヤー値としてはサポートされていない。

注意: grant は `GrantRegistry` に完全な URI `https://dplaax.dev/oauth/grant-type/did`
でのみ登録される。短縮形の `"did"` は登録されず、`unsupported_grant_type`
を返す。**設定キー**は `oauth.grants.did` のまま（メソッド名ベースで、
URI ベースではない。HOCON のキーにコロンが含まれるとクォートが必要になり
扱いにくいため）。以下の API リファレンスで `"did"` と表記されている箇所は
この設定キーを指しており、ワイヤー値やレジストリ識別子ではない。

### なぜ `https://dplaax.dev/...` の URI なのか？

RFC 6749 §4.5 は拡張 grant を絶対 URI で識別する。プロトコル定義者が所有するドメイン配下の `https://` URI は、**ドメイン所有そのものが名前空間の正当性の証明**になるため、どこにも登録が要らない（初期の版では `urn:dplaax:...` を使っていたが、formal な `urn:` 名前空間 ID は RFC 8141 上 IANA 登録が必要で、https URI はそれを丸ごと回避できる）。この URI はトークンエンドポイントがバイト単位で比較する識別子であり、実行時に取得（dereference）されることはない。ただし dPLaaX プロジェクトはこのアドレスに grant の説明文書をホストする予定である。

ワイヤープロトコルを拡張したい（例: Verifiable Presentation を埋め込む）コンシューマーのデプロイメントは、この URI をオーバーライドするのではなく、自分が所有するドメイン配下（例: `https://example.com/oauth/grant-type/did-vp`）で新しい grant を定義すること。

## インストール

```bash
npm install @provin-line/auth-provider-did
```

オプションの peer dependency（`ed25519_raw` および `ed25519_prehash` アルゴリズム使用時に必要。JWS 系アルゴリズムでは不要）:

```bash
npm install @noble/ed25519
```

## パブリック API

### `oauthDidModule`

```typescript
function oauthDidModule(options: DidModuleOptions): Module;
```

モジュール（name: `"oauth-did"`）を返すファクトリ関数。grant を grant-type URI `https://dplaax.dev/oauth/grant-type/did` で contribute する（`oauth.grants.did` は**設定キー**であり、ワイヤー値やレジストリキーではない）。

v0.5 の manifest モデルでは登録は宣言的: DID 認証を有効化するには本モジュールを `createApp` の `modules` 配列に含める。`oauth.grants.did.enabled` の設定フィールドは HOCON 後方互換のため受け付けるが、ランタイムでは無視される — modules 配列に入れるか否かが contribute の条件。

`DidModuleOptions` には DID ドキュメントリゾルバーを以下のいずれかの形式で渡す。加えてカスタムアルゴリズムを注入する `verifierRegistry` を任意で指定できる:

```typescript
type DidModuleOptions =
  | { resolver: DidDocumentResolver; verifierRegistry?: VerifierRegistry }
  | {
      resolverFactory: (config: Record<string, unknown>) => DidDocumentResolver;
      verifierRegistry?: VerifierRegistry;
    };
```

- **`resolver`** — 構築済みのリゾルバーインスタンス
- **`resolverFactory`** — 初期化時に DID grant config セクションを受け取りリゾルバーを返すファクトリ関数
- **`verifierRegistry`** — built-in 以外のアルゴリズムを登録するための `VerifierRegistry`。省略時は 5 種類の built-in を持つレジストリが使われる

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

DID grant ハンドラー（grant-type URI `https://dplaax.dev/oauth/grant-type/did` で登録される）を生成するファクトリ関数。ハンドラーが期待するリクエストボディフィールド:

| フィールド           | 説明                                               |
|---------------------|---------------------------------------------------|
| `did`               | 認証するパーティの DID                              |
| _(アルゴリズム依存)_ | 設定されたアルゴリズムによって追加フィールドが異なる  |

受け入れるアルゴリズム集合は `config.oauth.grants.did.supportedAlgorithms`（文字列配列）で設定する。後方互換のため、旧来の単一値 `algorithm` フィールドも `supportedAlgorithms` が無い場合の alias として受け付ける。built-in アルゴリズム:

| アルゴリズム        | 説明                                                                            |
|-------------------|---------------------------------------------------------------------------------|
| `ed25519_raw`     | 生の Ed25519 署名（デフォルト）。`@noble/ed25519` が必要。                       |
| `ed25519_prehash` | 事前ハッシュ（SHA-256）した Ed25519 署名。`@noble/ed25519` が必要。              |
| `ed25519_jws`     | JWS エンベロープに包んだ Ed25519 署名                                            |
| `es256_jws`       | ES256 (P-256) JWS                                                               |
| `es256k_jws`      | ES256K (secp256k1) JWS                                                          |

---

### `didConfigSchema`

```typescript
const didConfigSchema: z.ZodObject<{
  oauth: {
    grants: {
      did: {
        /** @deprecated 登録は modules 配列で決まる; ランタイムでは無視される。 */
        enabled?: boolean;
        /** @deprecated supportedAlgorithms を使うこと。後方互換のため残置。 */
        algorithm?: string;
        supportedAlgorithms: string[]; // default: ["ed25519_raw"]
        messageMaxAgeSec: number;      // default: 300
        allowedAudiences: string[];    // default: []
      };
    };
  };
}>;
```

DID grant 設定スライス用の Zod スキーマ。形状はランタイムの読み取りパス（`config.oauth.grants.did.*`）と一致しており、`defineModule` の `configSchema` slot で `CoreConfigSchema` と合成したときに、ここで宣言したデフォルト値がブート時に grant factory まで届く。`supportedAlgorithms` が受理アルゴリズムを決める主フィールドで、旧来の単一値 `algorithm` は後方互換 alias として受け付ける。

---

### `createVerifier`

```typescript
function createVerifier(
  algorithm: Algorithm,
  pathResolver?: PathResolver,
): Promise<SignatureVerifier>;
```

指定したアルゴリズム用の `SignatureVerifier` を生成する。`pathResolver` はディスク上の鍵マテリアルの場所解決に使用する（一部のアルゴリズムで必要）。

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

`resolvedKey` は `extractVerificationKey(didDocument, did)` で生成する。`ExtractedKey` も export されている。

---

### `VerificationResult` (type)

```typescript
type VerificationResult =
  | { valid: true; subject: string; audience?: string; parsedMessage: ParsedMessage }
  | { valid: false; error: string; errorDescription: string };
```

`subject` や `parsedMessage` にアクセスする前に `valid` を確認すること。

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

`Algorithm` は意図的に open な `string` 型で、`VerifierRegistry` 経由でカスタムアルゴリズムを登録できる。本パッケージが同梱する built-in 識別子: `ed25519_raw`、`ed25519_prehash`、`ed25519_jws`、`es256_jws`、`es256k_jws`。

## 使い方

```typescript
import {
  createApp,
  createKeyStoreFromConfig,
  defineModule,
} from "@o3co/auth-provider-core";
import { oauthDidModule } from "@provin-line/auth-provider-did";

// `oauthDidModule` は `requires: ["config", "keyStore", "pathResolver"]` を宣言する。
// `config` と `pathResolver` は `bootstrapComponents` から流れるが、`keyStore` は
// 別モジュールから供給する必要がある。最小形は config から keyStore を構築して
// `defineModule` で公開する 1 行モジュール。
const keyStore = await createKeyStoreFromConfig(config.oauth.jwt);
const keyStoreModule = defineModule({
  name: "app:key-store",
  provides: { keyStore: () => keyStore },
});

// 任意の config slice（全フィールドにデフォルト値あり）:
//   config.oauth.grants.did.supportedAlgorithms = ["ed25519_raw"]
//   config.oauth.grants.did.messageMaxAgeSec = 300
//   config.oauth.grants.did.allowedAudiences = []

const handle = await createApp({
  modules: [
    oauthDidModule({ resolver: myResolver }),
    keyStoreModule,
    // …他のモジュール
  ],
  bootstrapComponents: { config, pathResolver },
});
// handle.dispose() でシャットダウン時にリソース解放
```

### 署名の直接検証

```typescript
import {
  createVerifier,
  extractVerificationKey,
} from "@provin-line/auth-provider-did";

const verifier = await createVerifier("ed25519_jws");
const resolvedKey = await extractVerificationKey(didDocument, did);
const result = await verifier.verify({ did, body: requestBody, resolvedKey });

if (result.valid) {
  console.log("認証済み subject:", result.subject);
} else {
  console.error(result.error, result.errorDescription);
}
```

## 本番運用における注意事項

### Nonce リプレイ保護

DID grant は nonce のリプレイ保護にインメモリストアを使用しています。これには以下の 2 つの制限があります。

1. **プロセス再起動**: 再起動時に保存済み nonce が失われるため、`messageMaxAgeSec`（デフォルト: 300 秒）の間リプレイ攻撃が可能になります
2. **マルチインスタンス環境**: 各インスタンスが独自の nonce ストアを保持するため、あるインスタンスで使用した nonce を別のインスタンスでリプレイできます

より強固なリプレイ保護が必要な本番環境では、外部の nonce ストア（例: Redis）の使用を推奨します。プラガブルなバックエンドに対応する `NonceStore` インターフェースは将来のリリースで提供予定です。

## 関連

- [`@o3co/auth-provider-core`](https://www.npmjs.com/package/@o3co/auth-provider-core) — 共有型定義 (`Module`、`defineModule`、`GrantHandler`、`GrantDependencies`)

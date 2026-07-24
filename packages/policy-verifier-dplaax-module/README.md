# @provin-line/policy-verifier-dplaax-module

dPLaaX attribute and rule collectors plus module wiring for [`@o3co/auth.policy-verifier.server`](https://www.npmjs.com/package/@o3co/auth.policy-verifier.server). Part of [dplaax.auth](../../README.md).

This package is the upstream dPLaaX extension that a deployment consumes alongside the o3co framework. A deployment's `main.mts` registers `dplaaxModule` next to the framework's `builtinCollectorsModule`, and that is enough to surface dPLaaX attributes (`subjectDid`, `subscriberDid`, `subjectDidType`) and rule collectors (`SubscriberIdentityCheckRuleCollector`, `SubjectDidTypeRuleCollector`, `DefaultDenyRuleCollector`) to the policy verifier.

## What it provides

### Attribute collectors

| Collector | Attribute | Source |
| --- | --- | --- |
| `SubjectDidCollector` | `subjectDid` | JWT payload `sub` (when the subject is a DID) |
| `SubscriberDidCollector` | `subscriberDid` | request-context placeholder `subscriber_did` |
| `SubjectDidTypeCollector` | `subjectDidType` | derived from the DID hierarchy level (`owner` / `pipeline` / `process`) |

### Rule collectors

| Collector | Rule shape | Effect |
| --- | --- | --- |
| `SubscriberIdentityCheckRuleCollector` | `{ resource, action }` per entry | When the request's resource+action matches, the authenticated subject DID MUST equal the declared subscriber DID. |
| `SubjectDidTypeRuleCollector` | `{ resource, action, allowedTypes }` per entry | When matched, the subject DID's hierarchy level MUST be in `allowedTypes`. |
| `DefaultDenyRuleCollector` | `{ surface: [{ resource, action }] }` | Fail-closed default: a request whose resource+action is NOT declared in `surface` is denied unconditionally (dedicated `default_deny` rule group, so no rule from another group can override it). Matching an entry is an abstention, not a grant. The ruleType `default_deny` is **reserved** — a custom collector emitting a passing rule under that ruleType would neutralize the deny (rules OR within a group); never emit it elsewhere. |

All rule collectors support exact resource+action match and a wildcard `action: "*"` for "every action of this resource"; exact match wins over wildcard regardless of config order. Matching is against the raw resource string as sent by the PEP — instance ids are not stripped, and there is no `resource` wildcard (`resource: "*"` is a literal).

**SECURITY NOTE**: the upstream evaluator allows a request when zero rules
are collected, and the other rule collectors abstain on pairs they are not
configured for — so without `DefaultDenyRuleCollector` an unconfigured
`(resource, action)` is silently allowed. Keep it enabled (the
`create-policy-verifier` scaffold ships it with the full dPLaaX L1 request
surface) and extend `surface` deliberately when the deployment gains a new
RPC.

## Usage

Register the module on app startup:

```ts
import { builtinCollectorsModule } from "@o3co/auth.policy-verifier.builtins";
import { createApp } from "@o3co/auth.policy-verifier.server";
import { dplaaxModule } from "@provin-line/policy-verifier-dplaax-module";

const app = await createApp({
    pathResolver: import.meta.resolve,
    config,
    modules: [builtinCollectorsModule, dplaaxModule],
});
```

Then reference the dPLaaX collectors from `config/application.conf` under `attribute.collectors` and `rule.collectors`:

```hocon
attribute {
  collectors = [
    { collector = "SubjectDidCollector" }
    { collector = "SubscriberDidCollector" }
    { collector = "SubjectDidTypeCollector" }
    # ...
  ]
}

rule {
  collectors = [
    {
      collector = "DefaultDenyRuleCollector"
      surface = [
        # the deployment's declared request surface — keep in sync with the
        # RPCs the deployment actually serves (see SECURITY NOTE above)
        { resource = "dids", action = "read" }
        # ...
      ]
    }
    {
      collector = "SubscriberIdentityCheckRuleCollector"
      rules = []   # deployment-specific entries go here
    }
    {
      collector = "SubjectDidTypeRuleCollector"
      rules = []
    }
  ]
}
```

## Distribution

This package is **not published to npm**. Consumers reference it via pnpm's git-subdirectory dependency form:

```jsonc
{
  "dependencies": {
    "@provin-line/policy-verifier-dplaax-module":
      "github:provin-line/auth#<release-tag>&path:/packages/policy-verifier-dplaax-module"
  }
}
```

See [create-app.md § 3.1 / § 3.3](../../docs/create-app.md) for the rationale and the consumer-facing scaffolding command.

## License

[Apache-2.0](./LICENSE). Copyright 2026 1o1 Co. Ltd.

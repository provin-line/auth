# @provin-line/auth-did-grant-store

Wires [`@provin-line/auth-did-grant`](../did-grant/README.md)'s store interface, spent nonces, to auth.provider's `records` on the kernel's `store`, as upstream's `jwt-bearer-store` wires `jwt-bearer`.

Its one space, `did-grant-store.spent`, declares a guarantee for each need `did-grant` states (`spentNoncesNeeds`: never evicted, durable, replicated). A need with nothing mapped to it fails the type check. `did-grant`'s `spentNoncesContract`, run on a simulated store that loses what a missing guarantee allows, checks what each guarantee means. The wiring only maps, with no branches or loops.

Export: `./module` (default export), named `did-grant-store`, with no section. Compose it with a `store` that offers the guarantees: auth.provider's in-memory store refuses them unless `store.accept-volatile = true`, which suits a single instance only.

auth.provider's packages, `@provin-line/auth-did-grant` and zod are peers: the kernel finds contracts by the object itself.

# ADR 038 — No preset accounts: fresh installs ship empty; first creator becomes admin

## Status
Accepted 2026-11-17. Amends ADR 016 (fresh-install seeding) and spec 27
(`followsServerLibrary` on seed-time profiles). Specs 03, 27 and 28 updated in
the same change.

## Context

Early development seeded a household's own accounts — `admin`, `ben`, `dad`,
`mum` — on every server boot of an empty database (`seedDefaultProfiles`), plus
`test` and `admin-test` when `SEED_TEST_ACCOUNTS=true`. The install-time list was
tailored to one household; a buyer of this software received accounts named after
its original author's family. That is a leak of the author's personal context
into every fresh deployment, and it is wrong for a general-purpose product.

Removing the seed outright would also remove the only way a fresh household got
an admin and a full shelf, so the change came with the bootstrap rule below.

## Decision

- **No profiles are seeded on a fresh install.** The boot-time `seedDefaultProfiles`
  call, `DEFAULT_PROFILES`, `TEST_PROFILES` and `npm run seed:profiles` are removed.
- **The first profile created in the app becomes the household admin**
  (`role = 'admin'`, `followsServerLibrary = true`) and absorbs every book that
  exists at that moment, mirroring the retired seeded admin's behaviour.
- **Every profile created afterwards is a plain member** with an empty shelf;
  shelving happens explicitly, as it already did for in-app-created profiles.
- Test flows create the profiles they need; nothing depends on named fixtures.

Existing installations are unaffected: rows already present are kept, and no
names are renamed or deleted by this change.

## Consequences

- A fresh household sets the app up by opening it and choosing a name, not by
  learning a shipped account's existence.
- The household password (`APP_PASSWORD`) remains the break-glass/recovery
  credential; it gates profile claiming and can mint an admin break-glass
  session, unchanged.
- E2E and integration tests create profiles on demand (`bootstrap.test.ts`
  pins the first-profile rule; `pickAnyProfile` in `e2e/helpers.ts` shelves the
  server library when it creates one).

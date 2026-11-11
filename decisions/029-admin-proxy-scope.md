# ADR 029 — The admin proxy belongs to the hosted single-port deployment only

## Status

Accepted 2026-11-11. Refines ADR 025 and restores ADR 022 for the household
deployment. Spec: [`specs/37-architecture-deepening.md`](../specs/37-architecture-deepening.md),
step 7.9.

## Context

ADR 022 put the admin panel on a second listener on its own port, and stated
that the public listener has no admin route at all. ADR 025 then carved a
deliberate exception, **for the hosted Render deployment only**: the public
listener proxies `/admin` and `/api/admin/*` to the loopback admin app,
because that deployment exposes one web port and the panel has no other
route in.

The implementation did not honour the scope. `server/src/index.ts` set
`adminProxyTarget` unconditionally, and `docker-compose.yml` published the
admin port by default — so the household deployment, which has its own admin
port and never asked for the proxy, carried the supersession too: `/admin`
on the family port, exactly the surface ADR 022 said a family origin must
not have.

## Decision

The proxy belongs **to the hosted single-port deployment only** — the Render
service and the books.home.arpa production compose, where one public web
port is the only route to the operator and the household compose pattern
(admin on its own port) is unavailable.

It is enabled by `ADMIN_PROXY=true`, set by that deployment's compose
(`docker-compose.prod.yml`). Everywhere else — the household default
(`docker-compose.yml`) and a bare `node server/index.js` with no flag — the
family listener registers **no** `/admin` or `/api/admin/*` route at all and
answers 404 for both. The admin panel is reached on its own port
(own `ADMIN_PORT`; the base household compose publishes it — the
`docker-compose.admin.yml` override existed briefly and was removed
2026-11-11 as redundant).

## Consequences

- **Behaviour change, intended:** the household deployment loses the
  family-port `/admin` surface. An operator on a household deployment uses
  the admin port instead. The hosted deployment is unchanged.
- Tests cover both states: `app.test.ts` proxies and logs in with a target
  configured, and asserts 404 for `/admin` and `/api/admin/*` without one.
- `docker-compose.prod.yml` sets `ADMIN_PROXY=true` with a comment; the
  household compose omits it.
- ADR 025 remains valid for the hosted deployment; nothing else about it
  changes (the admin listener's own auth, upload URLs and storage stay as
  designed).

## Alternatives considered

- **Keep the proxy unconditional and amend ADR 022 to say every deployment
  gets it.** Rejected: it extends an exception scoped to one deployment to
  all of them — the exact failure this ADR corrects — and hands every
  household a second surface on the family origin for no operational gain.
- **Remove the proxy and let the hosted deployment expose the admin port.**
  Rejected: the hosted deployment has a single public web port; that is the
  condition the exception exists for.
- **A new deployment flavour flag (`DEPLOYMENT=hosted|home`).** Rejected:
  `ACCOUNT_EXPERIENCE` and `NETWORK_MODE` already describe different axes;
  one boolean naming the specific capability (`ADMIN_PROXY`) is the smallest
  change that restores the intent.

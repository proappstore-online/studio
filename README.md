# wellness

Multi-tenant studio booking platform — Mindbody / Momence-shaped product,
published on **proappstore.online** as one of the apps in the marketplace.

A wellness studio owner signs in, creates a row in the `studios` table for
their business, defines class types with categories (Yoga, Pilates, HIIT,
…), schedules recurring weekly classes, and takes bookings from clients.

Live at **https://wellness.proappstore.online** (once DNS propagates) or
the deploy URL on `pages.dev`.

## Why PAS

PAS is a deliberate fit for this product:

- `app.db` — one shared D1 across all tenants (the **Ready** category from
  `pas/platform/STRATEGY.md`). Studios are rows, not forks.
- `app.rooms` — uncapped on Pro. Live class capacity ("3 spots left"),
  waitlist promotions, real-time class chat.
- `app.notifications` — Web Push for class reminders.
- `app.sms` — Twilio-backed SMS reminders.
- `app.ai` — Workers AI for class descriptions, marketing copy.
- `app.auth` — GitHub, Google, or email magic-link.
- Cron — 24h-before reminders, no-show sweeps, daily digests.

## Tenancy

ONE D1, MANY studios. Every business table carries `tenant_id` (= `studios.id`).

**Discipline required:** every query MUST be scoped by `tenant_id`. A single
missed `WHERE tenant_id = ?` is a cross-studio data leak. Until PAS ships
a server-side tenant-aware D1 primitive (open decision in
`pas/platform/STRATEGY.md`), this discipline lives in the app code.

## Schema

See [`migrations/`](./migrations/). Core tables:

- `studios` — the tenants (yoga studios, gyms, dance studios)
- `staff` — FAS users with a role inside a studio
- `clients` — end-customers (may or may not have a FAS account)
- `class_types` — reusable class templates (with category from a fixed list)
- `schedules` — recurring weekly rules ("Mon/Wed/Fri 6pm")
- `sessions` — scheduled instances on the calendar (generated from schedules)
- `bookings` — a client holding a spot in a session
- `packages`, `client_packages` — drop-in / classpack / membership

## Layout

- `public/` — static HTML/JS for the storefront (deployed to CF Pages)
- `api/` — vendored data-worker (per-app Hono worker bound to wellness D1)
- `migrations/` — D1 schema migrations
- `tests/` — Playwright E2E

## Next

1. Sessions calendar (week view, drag/move/cancel).
2. Client signup + booking flow on the public studio page.
3. SMS + push reminders via `app.sms` / `app.notifications` (needs platform secrets).
4. Replace inlined fetches with `@proappstore/sdk` once we add a bundle step.

## License

MIT.

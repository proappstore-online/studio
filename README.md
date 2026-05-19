# studio

Multi-tenant booking platform — Mindbody / Momence-shaped product, built on PAS.

A studio owner signs up, gets their own row in the `studios` table, invites
staff, defines class types, schedules sessions, takes bookings from clients.

## Why PAS

PAS is a deliberate fit for this product:

- `app.db` — one shared D1 across all tenants (the **Ready** category from
  `pas/platform/STRATEGY.md`). Studios are rows, not forks.
- `app.rooms` — uncapped on Pro. Live class capacity ("3 spots left"),
  waitlist promotions, real-time class chat.
- `app.notifications` — Web Push for class reminders.
- `app.sms` — Twilio-backed SMS reminders (added to platform alongside this app).
- `app.auth` — GitHub, Google, or **email magic-link** (added to platform
  alongside this app; clients aren't on GitHub).
- Workers AI tokens — auto-generated class descriptions, scheduling hints.
- Cron — 24h-before reminders, no-show sweeps, daily digests.

## Tenancy

ONE D1, MANY studios. Every business table carries `tenant_id` (= `studios.id`).

**Discipline required:** every query MUST be scoped by `tenant_id`. A single
missed `WHERE tenant_id = ?` is a cross-studio data leak. Until PAS ships a
tenant-aware D1 wrapper (open decision in `pas/platform/STRATEGY.md`), this
discipline lives in the app code.

## Schema

See [`migrations/0001_init.sql`](./migrations/0001_init.sql). Core tables:

- `studios` — the tenants
- `staff` — FAS users with a role inside a studio
- `clients` — end-customers (may or may not have a FAS account)
- `class_types` — reusable class templates
- `sessions` — scheduled instances on the calendar
- `bookings` — a client holding a spot in a session
- `packages`, `client_packages` — drop-in / classpack / membership

## Status

Scaffold. Not yet wired to PAS publishing. Next steps:

1. Build a minimal admin UI (studio dashboard) and client UI (book a class).
2. Wire `app.sms` to send reminders 1h before each session via cron.
3. Use `app.notifications` to nudge waitlisted clients when a spot opens.
4. Use email magic-link auth (`auth.signInWithEmail`) for client sign-in.

## License

MIT.

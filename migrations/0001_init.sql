-- studio: multi-tenant booking app on PAS (Ready category).
--
-- Tenancy model: ONE D1 database for the entire app, MANY studios as rows.
-- Every business table carries `tenant_id` (= studios.id). The publisher
-- (this app) MUST scope every query by tenant_id. A single missed
-- `WHERE tenant_id = ?` is a cross-studio data leak.
--
-- A platform-level tenant-aware wrapper is the natural follow-up — see
-- pas/platform/STRATEGY.md "Open decisions" (multi-tenant primitives).

CREATE TABLE IF NOT EXISTS studios (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,        -- subdomain-ish: book.studio.app/<slug>
  name          TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,                -- FAS user id (owner / primary admin)
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  currency      TEXT NOT NULL DEFAULT 'AUD',
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  brand_color   TEXT,
  logo_url      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studios_owner ON studios(owner_user_id);

-- Staff: FAS users with a role inside a studio.
CREATE TABLE IF NOT EXISTS staff (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT NOT NULL,                -- FAS user id
  role        TEXT NOT NULL,                -- 'owner' | 'admin' | 'instructor' | 'frontdesk'
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(tenant_id);

-- Clients: end-customers of a studio. May or may not have a FAS account.
CREATE TABLE IF NOT EXISTS clients (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  user_id     TEXT,                         -- FAS user id, null until claimed
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,                         -- E.164 for SMS reminders
  birthdate   TEXT,
  notes       TEXT,
  tags        TEXT,                         -- JSON array of strings
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant       ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_user  ON clients(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_email ON clients(tenant_id, email);

-- Class types: reusable class templates ("Vinyasa Flow", "HIIT", etc.).
CREATE TABLE IF NOT EXISTS class_types (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  duration_minutes  INTEGER NOT NULL,
  default_capacity  INTEGER NOT NULL DEFAULT 20,
  price_cents       INTEGER NOT NULL DEFAULT 0,
  color             TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_types_tenant ON class_types(tenant_id);

-- Scheduled instances of a class on the calendar.
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  class_type_id  TEXT NOT NULL,
  instructor_id  TEXT,                       -- staff.id
  starts_at      INTEGER NOT NULL,           -- unix ms (UTC)
  ends_at        INTEGER NOT NULL,
  capacity       INTEGER NOT NULL,
  location       TEXT,
  is_virtual     INTEGER NOT NULL DEFAULT 0,
  meeting_url    TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled|cancelled|completed
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_time       ON sessions(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_instructor ON sessions(tenant_id, instructor_id);

-- A booking is a client holding a spot in a session.
CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  session_id     TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed', -- confirmed|waitlisted|cancelled|no_show|attended
  booked_at      INTEGER NOT NULL,
  checked_in_at  INTEGER,
  cancelled_at   INTEGER,
  source         TEXT,                       -- web|staff|mobile|integration
  UNIQUE (session_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_session ON bookings(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_client  ON bookings(tenant_id, client_id);

-- Packages: drop-in, class-pack, recurring membership.
CREATE TABLE IF NOT EXISTS packages (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,                -- dropin|classpack|membership
  credits       INTEGER,                       -- classpack: number of classes
  period_days   INTEGER,                       -- membership: e.g. 30
  price_cents   INTEGER NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_packages_tenant ON packages(tenant_id);

-- A package purchased by a client (credits remaining, expiry).
CREATE TABLE IF NOT EXISTS client_packages (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  client_id          TEXT NOT NULL,
  package_id         TEXT NOT NULL,
  credits_remaining  INTEGER,
  starts_at          INTEGER NOT NULL,
  expires_at         INTEGER,
  status             TEXT NOT NULL DEFAULT 'active', -- active|expired|cancelled
  created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clientpkg_tenant_client ON client_packages(tenant_id, client_id);

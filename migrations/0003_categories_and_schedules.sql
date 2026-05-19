-- Mindbody-style class taxonomy + recurring schedules.
--
-- Three entities involved:
--   class_types  — TEMPLATE (Mindbody "Class Description"). Now with category.
--   schedules    — RECURRING RULE ("Every Mon/Wed/Fri at 6pm for 8 weeks").
--                  This is what owners create; the system materializes sessions
--                  from it for the next N weeks.
--   sessions     — INSTANCE on the calendar. Has a nullable schedule_id so it
--                  remembers which schedule generated it (so the owner can
--                  later edit the schedule and regenerate forward-looking
--                  instances without losing past attendance / bookings).

ALTER TABLE class_types ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_class_types_tenant_category
  ON class_types(tenant_id, category);

CREATE TABLE IF NOT EXISTS schedules (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  class_type_id     TEXT NOT NULL,
  instructor_id     TEXT,                       -- staff.id; nullable
  -- Day-of-week mask: comma-separated 0..6 where 0=Sun, 1=Mon, ..., 6=Sat.
  -- e.g. "1,3,5" = Mon/Wed/Fri.
  days_of_week      TEXT NOT NULL,
  -- "HH:MM" 24h. Interpreted in the studio's timezone (studios.timezone).
  start_time        TEXT NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  capacity          INTEGER NOT NULL,
  location          TEXT,
  is_virtual        INTEGER NOT NULL DEFAULT 0,
  meeting_url       TEXT,
  -- Effective window. starts_on is the anchor; sessions are only generated
  -- from this date forward. ends_on is the cutoff (null = open-ended).
  starts_on         INTEGER NOT NULL,           -- unix ms (UTC; date-only)
  ends_on           INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',  -- active | paused | ended
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant       ON schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant_class ON schedules(tenant_id, class_type_id);

ALTER TABLE sessions ADD COLUMN schedule_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_schedule
  ON sessions(tenant_id, schedule_id);

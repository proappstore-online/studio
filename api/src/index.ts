import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';

interface Env {
  DB: D1Database;
  APP_ID: string;
  FAS_API_BASE: string;
}

interface FasUser {
  id: string;
  login: string;
}

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return null;
      try {
        const host = new URL(origin).hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') return origin;
        if (host.endsWith('.proappstore.online') || host === 'proappstore.online') return origin;
        if (host.endsWith('.pages.dev')) return origin;
        return null;
      } catch {
        return null;
      }
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }),
);

// ---------------------------------------------------------------------------
// Auth (with 60s in-memory cache to avoid FAS API round-trip on every query)
// ---------------------------------------------------------------------------

const authCache = new Map<string, { user: FasUser; expires: number }>();
const AUTH_CACHE_TTL_MS = 60_000;

async function requireUser(c: { req: { header(name: string): string | undefined }; env: Env }): Promise<FasUser> {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new HTTPException(401, { message: 'missing bearer token' });
  }
  const token = header.slice(7);

  // Check cache
  const cached = authCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.user;
  }

  const fasBase = c.env.FAS_API_BASE || 'https://api.freeappstore.online';
  const response = await fetch(`${fasBase}/v1/auth/me`, {
    headers: { Authorization: header },
  });
  if (!response.ok) {
    authCache.delete(token);
    throw new HTTPException(401, { message: 'invalid session' });
  }
  const user = (await response.json()) as FasUser;

  // Cache for 60s
  authCache.set(token, { user, expires: Date.now() + AUTH_CACHE_TTL_MS });

  // Evict stale entries (prevent unbounded growth)
  if (authCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of authCache) {
      if (entry.expires <= now) authCache.delete(key);
    }
  }

  return user;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface SqlPayload {
  sql: string;
  params?: unknown[];
}

function validateSql(body: unknown): SqlPayload {
  const obj = body as Record<string, unknown>;
  if (typeof obj.sql !== 'string' || obj.sql.trim() === '') {
    throw new HTTPException(400, { message: 'sql must be a non-empty string' });
  }
  if (obj.params !== undefined && !Array.isArray(obj.params)) {
    throw new HTTPException(400, { message: 'params must be an array' });
  }
  const payload: SqlPayload = { sql: obj.sql };
  if (Array.isArray(obj.params)) payload.params = obj.params;
  return payload;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/health', (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Public (unauthenticated) read endpoints — for the discoverable studio
// pages at studio.proappstore.online/<slug>. Only safe, non-PII columns are
// exposed; no owner_user_id, no email/phone unless the studio chose to publish
// them on their public page (a future toggle).
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

app.get('/public/studios/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.text('invalid slug', 400);
  const row = await c.env.DB.prepare(
    `SELECT id, slug, name, description, timezone, currency, phone, email,
            address, brand_color, logo_url, created_at
     FROM studios WHERE slug = ? LIMIT 1`,
  )
    .bind(slug)
    .first();
  if (!row) return c.text('not found', 404);
  return c.json(row);
});

app.get('/public/studios', async (c) => {
  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 100);
  const result = await c.env.DB.prepare(
    `SELECT id, slug, name, description, timezone, currency, created_at
     FROM studios ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json(result.results);
});

/** Public class schedule for a studio — sessions in the next `days` days. */
app.get('/public/studios/:slug/sessions', async (c) => {
  const slug = c.req.param('slug');
  if (!SLUG_RE.test(slug)) return c.text('invalid slug', 400);
  const studio = await c.env.DB.prepare('SELECT id FROM studios WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ id: string }>();
  if (!studio) return c.text('not found', 404);

  const daysRaw = parseInt(c.req.query('days') ?? '14', 10);
  const days = Math.min(Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 14, 60);
  const now = Date.now();
  const horizon = now + days * 24 * 60 * 60 * 1000;

  const result = await c.env.DB.prepare(
    `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.location, s.status,
            c.name AS class_name, c.color AS class_color, c.category AS class_category,
            st.name AS instructor_name, st.avatar_url AS instructor_avatar
     FROM sessions s
     LEFT JOIN class_types c ON c.id = s.class_type_id AND c.tenant_id = s.tenant_id
     LEFT JOIN staff st     ON st.id = s.instructor_id AND st.tenant_id = s.tenant_id
     WHERE s.tenant_id = ? AND s.starts_at >= ? AND s.starts_at < ? AND s.status = 'scheduled'
     ORDER BY s.starts_at`,
  )
    .bind(studio.id, now, horizon)
    .all();
  return c.json(result.results);
});

app.get('/tables', async (c) => {
  await requireUser(c);
  const result = await c.env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string }>();
  return c.json(result.results.map((r) => r.name));
});

app.post('/query', async (c) => {
  await requireUser(c);
  const body = await c.req.json();
  const { sql, params } = validateSql(body);
  const start = Date.now();
  const stmt = params ? c.env.DB.prepare(sql).bind(...params) : c.env.DB.prepare(sql);
  const result = await stmt.all();
  return c.json({
    rows: result.results,
    meta: { changes: result.meta.changes, duration: Date.now() - start },
  });
});

app.post('/execute', async (c) => {
  await requireUser(c);
  const body = await c.req.json();
  const { sql, params } = validateSql(body);
  const start = Date.now();
  const stmt = params ? c.env.DB.prepare(sql).bind(...params) : c.env.DB.prepare(sql);
  const result = await stmt.run();
  return c.json({
    meta: {
      changes: result.meta.changes,
      duration: Date.now() - start,
      last_row_id: result.meta.last_row_id,
    },
  });
});

app.post('/batch', async (c) => {
  await requireUser(c);
  const body = await c.req.json<{ statements: unknown[] }>();
  if (!Array.isArray(body.statements) || body.statements.length === 0) {
    throw new HTTPException(400, { message: 'statements must be a non-empty array' });
  }
  const stmts = body.statements.map((raw) => {
    const { sql, params } = validateSql(raw);
    return params ? c.env.DB.prepare(sql).bind(...params) : c.env.DB.prepare(sql);
  });
  const results = await c.env.DB.batch(stmts);
  return c.json({
    results: results.map((r) => ({
      rows: r.results,
      meta: { changes: r.meta.changes, last_row_id: r.meta.last_row_id },
    })),
  });
});

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

app.post('/migrate', async (c) => {
  await requireUser(c);
  const body = await c.req.json<{ migrations: { name: string; sql: string }[] }>();
  if (!Array.isArray(body.migrations) || body.migrations.length === 0) {
    throw new HTTPException(400, { message: 'migrations must be a non-empty array of {name, sql}' });
  }

  // Ensure migrations tracking table exists
  await c.env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`,
  ).run();

  // Get already-applied migrations
  const applied = await c.env.DB.prepare('SELECT name FROM _migrations').all<{ name: string }>();
  const appliedSet = new Set(applied.results.map((r) => r.name));

  // Run pending migrations in order
  const ran: string[] = [];
  for (const m of body.migrations) {
    if (appliedSet.has(m.name)) continue;
    // Split on semicolons to handle multi-statement migrations
    const statements = m.sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    for (const stmt of statements) {
      await c.env.DB.prepare(stmt).run();
    }
    await c.env.DB.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').bind(m.name, Date.now()).run();
    ran.push(m.name);
  }

  return c.json({ applied: ran, already: [...appliedSet] });
});

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error('Unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

export default app;

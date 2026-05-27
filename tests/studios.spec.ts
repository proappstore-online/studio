import { expect, test, type Route } from '@playwright/test';

const FAS_API = 'https://api.freeappstore.online';
const PAS_API_GENERATE = 'https://api.proappstore.online/v1/ai/generate';
const STUDIO_API_QUERY = /data-wellness\.proappstore\.online\/query/;
const STUDIO_API_EXECUTE = /data-wellness\.proappstore\.online\/execute/;
const STUDIO_API_PUBLIC = /data-wellness\.proappstore\.online\/public\/studios/;

const USER = { id: 'gh:42', login: 'alice', avatarUrl: null };

async function signedIn(
  page: import('@playwright/test').Page,
  opts: { studios?: Record<string, unknown>[] } = {},
) {
  await page.route(`${FAS_API}/v1/auth/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(USER),
    }),
  );
  await page.route(STUDIO_API_QUERY, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rows: opts.studios ?? [], meta: { changes: 0, duration: 0 } }),
    }),
  );
  await page.addInitScript((u) => {
    localStorage.setItem('fas:session', JSON.stringify({ token: 'cached-token', user: u }));
  }, USER);
}

test.describe('studio creation', () => {
  test('shows empty state when the user has no studios', async ({ page }) => {
    await signedIn(page);
    await page.goto('/');
    await expect(page.locator('#signed-in-view')).toBeVisible();
    await expect(page.locator('#studios-empty')).toBeVisible();
    await expect(page.locator('#studios-list')).toBeHidden();
    await expect(page.getByText(/You don't have any studios yet/i)).toBeVisible();
  });

  test('lists existing studios when the user has some', async ({ page }) => {
    await signedIn(page, {
      studios: [
        {
          id: 'a',
          slug: 'yoga-haus',
          name: 'Yoga Haus',
          timezone: 'Australia/Sydney',
          currency: 'AUD',
          created_at: 1,
        },
        {
          id: 'b',
          slug: 'iron-gym',
          name: 'Iron Gym',
          timezone: 'America/New_York',
          currency: 'USD',
          created_at: 2,
        },
      ],
    });
    await page.goto('/');
    await expect(page.locator('#studios-list')).toBeVisible();
    await expect(page.locator('#studios-empty')).toBeHidden();

    const cards = page.locator('.studio-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('Yoga Haus');
    await expect(cards.nth(0)).toContainText('/yoga-haus');
    await expect(cards.nth(0)).toContainText('Australia/Sydney');
    await expect(cards.nth(0)).toContainText('AUD');
    await expect(cards.nth(1)).toContainText('Iron Gym');
    await expect(cards.nth(1)).toContainText('USD');
  });

  test('AI suggest button fills the description from app.ai.generate', async ({ page }) => {
    let aiCall: { prompt: string; maxTokens?: number; temperature?: number } | null = null;
    await page.route(PAS_API_GENERATE, async (route) => {
      aiCall = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: '"A neighbourhood haven for breath, balance, and the occasional headstand."',
          model: '@cf/meta/llama-3.1-8b-instruct',
          alias: 'fast',
        }),
      });
    });
    await signedIn(page);
    await page.goto('/');
    await expect(page.locator('#signed-in-view')).toBeVisible();

    // Empty name → "type a name first" error, no API call
    await page.locator('#btn-ai-describe').click();
    await expect(page.locator('#create-status')).toContainText(/Type a studio name first/);
    expect(aiCall).toBeNull();

    // With a name, the button calls /v1/ai/generate and fills the textarea
    await page.fill('#studio-name', 'Yoga Haus');
    await page.locator('#btn-ai-describe').click();

    await expect(page.locator('#studio-description')).toHaveValue(
      'A neighbourhood haven for breath, balance, and the occasional headstand.',
    );
    expect(aiCall).not.toBeNull();
    const c = aiCall as unknown as { prompt: string };
    expect(c.prompt).toContain('Yoga Haus');
    expect(c.prompt).toMatch(/wellness studio/);
  });

  test('AI suggest surfaces server errors on the create-status banner', async ({ page }) => {
    await page.route(PAS_API_GENERATE, (route) =>
      route.fulfill({ status: 503, body: 'AI quota exhausted' }),
    );
    await signedIn(page);
    await page.goto('/');
    await page.fill('#studio-name', 'Yoga Haus');
    await page.locator('#btn-ai-describe').click();

    const banner = page.locator('#create-status');
    await expect(banner).toHaveClass(/err/);
    await expect(banner).toContainText(/503/);
    // Button re-enables after failure (don't leave the user stuck).
    await expect(page.locator('#btn-ai-describe')).toBeEnabled();
  });

  test('creates a studio: posts INSERT with correct bindings, then reloads list', async ({ page }) => {
    let insertCall: { sql: string; params: unknown[] } | null = null;
    let queryCallCount = 0;

    await signedIn(page);

    // The /query mock from signedIn() returns [] — we override it here to
    // return [] on first call (initial load) and the new row on the second
    // (post-INSERT reload).
    await page.unroute(STUDIO_API_QUERY);
    await page.route(STUDIO_API_QUERY, async (route) => {
      queryCallCount++;
      if (queryCallCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ rows: [], meta: { changes: 0, duration: 0 } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [
              {
                id: 'new-id',
                slug: 'yoga-haus',
                name: 'Yoga Haus',
                timezone: 'Australia/Sydney',
                currency: 'AUD',
                created_at: 999,
              },
            ],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
    });

    await page.route(STUDIO_API_EXECUTE, async (route: Route) => {
      const body = JSON.parse(route.request().postData()!);
      insertCall = body;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { changes: 1, duration: 0, last_row_id: 1 } }),
      });
    });

    await page.goto('/');
    await expect(page.locator('#studios-empty')).toBeVisible();

    await page.fill('#studio-name', 'Yoga Haus');
    await page.fill('#studio-description', 'Warm room, warmer people.');
    await page.fill('#studio-tz', 'Australia/Sydney');
    await page.fill('#studio-currency', 'aud');
    await page.getByRole('button', { name: /Create studio/i }).click();

    // Status banner confirms creation
    await expect(page.locator('#create-status')).toContainText(/Created Yoga Haus/);

    // Studios list now shows the new row (queryCallCount === 2)
    await expect(page.locator('.studio-card')).toHaveCount(1);
    await expect(page.locator('.studio-card').first()).toContainText('Yoga Haus');

    // Verify the SQL + bindings we sent
    expect(insertCall).not.toBeNull();
    const captured = insertCall as unknown as { sql: string; params: unknown[] };
    expect(captured.sql).toContain('INSERT INTO studios');
    expect(captured.sql).toContain('description');
    expect(captured.sql).toContain('owner_user_id');
    // Bindings order: id, slug, name, description, owner_user_id, timezone, currency, brand_color, created_at
    expect(captured.params[1]).toBe('yoga-haus'); // slug derived from name
    expect(captured.params[2]).toBe('Yoga Haus'); // name
    expect(captured.params[3]).toBe('Warm room, warmer people.'); // description
    expect(captured.params[4]).toBe('gh:42'); // owner = signed-in user.id
    expect(captured.params[5]).toBe('Australia/Sydney');
    expect(captured.params[6]).toBe('AUD'); // currency upper-cased
    expect(captured.params[7]).toBe('#7c6a5c'); // brand_color from color picker default
    expect(typeof captured.params[0]).toBe('string'); // UUID id
    expect(typeof captured.params[8]).toBe('number'); // created_at ms
  });

  test('shows a clear error when slug conflicts (UNIQUE constraint)', async ({ page }) => {
    await signedIn(page);
    await page.route(STUDIO_API_EXECUTE, (route) =>
      route.fulfill({
        status: 500,
        body: 'db.execute failed: 500 UNIQUE constraint failed: studios.slug',
      }),
    );
    await page.goto('/');
    await page.fill('#studio-name', 'Yoga Haus');
    await page.getByRole('button', { name: /Create studio/i }).click();

    const banner = page.locator('#create-status');
    await expect(banner).toHaveClass(/err/);
    await expect(banner).toContainText(/already exists/);
    await expect(banner).toContainText(/yoga-haus/);
  });

  test('falls back to defaults when timezone/currency left blank', async ({ page }) => {
    let captured: { params: unknown[] } | null = null;
    await signedIn(page);
    await page.route(STUDIO_API_EXECUTE, async (route) => {
      captured = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { changes: 1, duration: 0, last_row_id: 1 } }),
      });
    });
    await page.goto('/');
    await page.fill('#studio-name', 'Bare Bones');
    await page.getByRole('button', { name: /Create studio/i }).click();

    await expect(page.locator('#create-status')).toContainText(/Created Bare Bones/);
    expect(captured).not.toBeNull();
    const c = captured as unknown as { params: unknown[] };
    expect(c.params[3]).toBeNull(); // description (omitted)
    expect(c.params[5]).toBe('UTC'); // timezone default
    expect(c.params[6]).toBe('AUD'); // currency default
  });

  test('does not POST when studio-name is empty', async ({ page }) => {
    let called = false;
    await signedIn(page);
    await page.route(STUDIO_API_EXECUTE, (route) => {
      called = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/');
    await page.locator('#create-form').evaluate((f) =>
      (f as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true })),
    );
    await page.waitForTimeout(200);
    expect(called).toBe(false);
  });
});

test.describe('edit studio (inline)', () => {
  test('Edit button swaps card for an edit form prefilled with current values', async ({ page }) => {
    await signedIn(page, {
      studios: [
        {
          id: 'a',
          slug: 'yoga-haus',
          name: 'Yoga Haus',
          description: 'Old description',
          timezone: 'UTC',
          currency: 'AUD',
          created_at: 1,
        },
      ],
    });
    await page.goto('/');
    await expect(page.locator('.studio-card')).toHaveCount(1);
    await page.locator('.btn-edit').click();

    await expect(page.locator('.edit-name')).toHaveValue('Yoga Haus');
    await expect(page.locator('.edit-description')).toHaveValue('Old description');
    await expect(page.locator('.edit-tz')).toHaveValue('UTC');
    await expect(page.locator('.edit-currency')).toHaveValue('AUD');
  });

  test('Save sends UPDATE with new values, scoped to id + owner_user_id', async ({ page }) => {
    let updateCall: { sql: string; params: unknown[] } | null = null;
    let queryCount = 0;
    await signedIn(page, {
      studios: [
        { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: null, timezone: 'UTC', currency: 'AUD', created_at: 1 },
      ],
    });

    // After UPDATE the page reloads the list — the second /query returns updated row.
    await page.unroute(STUDIO_API_QUERY);
    await page.route(STUDIO_API_QUERY, async (route) => {
      queryCount++;
      const studios =
        queryCount === 1
          ? [{ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: null, timezone: 'UTC', currency: 'AUD', created_at: 1 }]
          : [{ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus Renamed', description: 'Now with description', timezone: 'Australia/Sydney', currency: 'USD', created_at: 1 }];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: studios, meta: { changes: 0, duration: 0 } }),
      });
    });
    await page.route(STUDIO_API_EXECUTE, async (route) => {
      updateCall = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { changes: 1, duration: 0, last_row_id: 0 } }),
      });
    });

    await page.goto('/');
    await page.locator('.btn-edit').click();
    await page.locator('.edit-name').fill('Yoga Haus Renamed');
    await page.locator('.edit-description').fill('Now with description');
    await page.locator('.edit-tz').fill('Australia/Sydney');
    await page.locator('.edit-currency').fill('usd');
    await page.locator('.btn-save').click();

    // After save we land back on the card view, with updated content.
    await expect(page.locator('.studio-card strong').first()).toHaveText('Yoga Haus Renamed');
    await expect(page.locator('.studio-card p').first()).toHaveText('Now with description');

    expect(updateCall).not.toBeNull();
    const c = updateCall as unknown as { sql: string; params: unknown[] };
    expect(c.sql).toContain('UPDATE studios');
    expect(c.sql).toContain('WHERE id = ? AND owner_user_id = ?');
    expect(c.params).toEqual([
      'Yoga Haus Renamed',
      'Now with description',
      'Australia/Sydney',
      'USD',
      'a',
      'gh:42',
    ]);
  });

  test('Cancel discards changes and re-renders the original card', async ({ page }) => {
    await signedIn(page, {
      studios: [
        { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: 'desc', timezone: 'UTC', currency: 'AUD', created_at: 1 },
      ],
    });
    let executed = false;
    await page.route(STUDIO_API_EXECUTE, (route) => {
      executed = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/');
    await page.locator('.btn-edit').click();
    await page.locator('.edit-name').fill('something else');
    await page.locator('.btn-cancel').click();

    await expect(page.locator('.studio-card strong').first()).toHaveText('Yoga Haus');
    expect(executed).toBe(false);
  });

  test('Each card has Manage and View public page links pointing at /<slug>', async ({ page }) => {
    await signedIn(page, {
      studios: [
        { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: null, timezone: 'UTC', currency: 'AUD', created_at: 1 },
      ],
    });
    await page.goto('/');

    const manageLink = page.locator('.studio-card a').filter({ hasText: 'Manage' }).first();
    await expect(manageLink).toHaveAttribute('href', '/yoga-haus/admin');

    const publicLink = page.locator('.studio-card a').filter({ hasText: 'View public page' }).first();
    await expect(publicLink).toHaveAttribute('href', '/yoga-haus');
    await expect(publicLink).toHaveAttribute('target', '_blank');
  });
});

test.describe('public studio page', () => {
  test('renders studio details at /<slug>', async ({ page }) => {
    await page.route(STUDIO_API_PUBLIC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'a',
          slug: 'yoga-haus',
          name: 'Yoga Haus',
          description: 'Warm room, warmer people.',
          timezone: 'Australia/Sydney',
          currency: 'AUD',
          address: '123 Bondi Rd',
        }),
      }),
    );
    await page.goto('/yoga-haus');

    await expect(page.locator('#public-view')).toBeVisible();
    await expect(page.locator('#home-header')).toBeHidden();
    await expect(page.locator('#signin-view')).toBeHidden();
    await expect(page.locator('#public-hero h1')).toHaveText('Yoga Haus');
    await expect(page.locator('#public-hero .desc')).toHaveText('Warm room, warmer people.');
    await expect(page.locator('#public-hero .meta')).toContainText('Australia/Sydney');
    await expect(page.locator('#public-hero .meta')).toContainText('123 Bondi Rd');
    await expect(page).toHaveTitle(/Yoga Haus/);
  });

  test('shows not-found view when slug does not exist', async ({ page }) => {
    await page.route(STUDIO_API_PUBLIC, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto('/no-such-studio');

    await expect(page.locator('#notfound-view')).toBeVisible();
    await expect(page.locator('#public-view')).toBeHidden();
    await expect(page.locator('#signed-in-view')).toBeHidden();
  });

  test('rejects bad slug shapes locally without hitting the API', async ({ page }) => {
    let called = false;
    await page.route(STUDIO_API_PUBLIC, (route) => {
      called = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    // Uppercase letters → not a valid slug → notfound view, no API call.
    await page.goto('/UPPERCASE');
    await expect(page.locator('#notfound-view')).toBeVisible();
    await page.waitForTimeout(200);
    expect(called).toBe(false);
  });
});

test.describe('studio admin (/<slug>/admin)', () => {
  function setupOwnerCheck(
    page: import('@playwright/test').Page,
    opts: { studio: Record<string, unknown> | null; classes?: Record<string, unknown>[] } = {
      studio: null,
    },
  ) {
    return page.route(STUDIO_API_QUERY, (route) => {
      const body = JSON.parse(route.request().postData()!) as { sql: string };
      if (body.sql.includes('FROM studios WHERE slug')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: opts.studio ? [opts.studio] : [],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      if (body.sql.includes('FROM class_types')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: opts.classes ?? [],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      return route.fulfill({ status: 200, body: '{"rows":[]}' });
    });
  }

  test('shows admin view + empty class types state for the owner', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      classes: [],
    });

    await page.goto('/yoga-haus/admin');

    await expect(page.locator('#admin-view')).toBeVisible();
    await expect(page.locator('#admin-studio-name')).toHaveText('Yoga Haus');
    await expect(page.locator('#admin-studio-slug')).toHaveText('/yoga-haus');
    await expect(page.locator('#classes-empty')).toBeVisible();
    await expect(page.locator('#classes-list')).toBeHidden();
    await expect(page).toHaveTitle(/Yoga Haus · admin/);
  });

  test('lists existing class types', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      classes: [
        { id: 'c1', name: 'Vinyasa Flow', duration_minutes: 60, default_capacity: 20, color: '#ff0000' },
        { id: 'c2', name: 'Yin Yoga', duration_minutes: 75, default_capacity: 15, color: '#00ff00' },
      ],
    });
    await page.goto('/yoga-haus/admin');
    const cards = page.locator('.class-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('Vinyasa Flow');
    await expect(cards.nth(0)).toContainText('60 min · cap 20');
    await expect(cards.nth(1)).toContainText('Yin Yoga');
    await expect(cards.nth(1)).toContainText('75 min · cap 15');
  });

  test('redirects to public page when user is not the owner', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:999' },
    });
    await page.route(STUDIO_API_PUBLIC, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: null }),
      }),
    );

    await page.goto('/yoga-haus/admin');

    await expect(page).toHaveURL(/\/yoga-haus$/);
    await expect(page.locator('#public-view')).toBeVisible();
    await expect(page.locator('#admin-view')).toBeHidden();
  });

  test('shows sign-in when not authenticated', async ({ page }) => {
    // No localStorage seeded, /auth/me returns 401.
    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({ status: 401, body: '' }),
    );
    await page.goto('/yoga-haus/admin');

    await expect(page.locator('#signin-view')).toBeVisible();
    await expect(page.locator('#admin-view')).toBeHidden();
  });

  test('Add class type POSTs INSERT with correct bindings then reloads', async ({ page }) => {
    let insertCall: { sql: string; params: unknown[] } | null = null;
    let queryCount = 0;
    let classCallCount = 0;
    await signedIn(page);
    await page.unroute(STUDIO_API_QUERY);
    await page.route(STUDIO_API_QUERY, async (route) => {
      const body = JSON.parse(route.request().postData()!) as { sql: string };
      queryCount++;
      if (body.sql.includes('FROM studios')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [{ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' }],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      // class_types — return empty first, then [the inserted one]
      classCallCount++;
      const rows =
        classCallCount === 1
          ? []
          : [{ id: 'new', name: 'Vinyasa Flow', duration_minutes: 60, default_capacity: 20, color: '#6366f1' }];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows, meta: { changes: 0, duration: 0 } }),
      });
    });
    await page.route(STUDIO_API_EXECUTE, async (route) => {
      insertCall = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { changes: 1, duration: 0, last_row_id: 1 } }),
      });
    });

    await page.goto('/yoga-haus/admin');
    await expect(page.locator('#classes-empty')).toBeVisible();

    await page.fill('#class-name', 'Vinyasa Flow');
    await page.selectOption('#class-category', 'yoga');
    await page.getByRole('button', { name: /Add class type/i }).click();

    await expect(page.locator('#admin-status')).toContainText(/Added Vinyasa Flow/);
    await expect(page.locator('.class-card')).toHaveCount(1);

    expect(insertCall).not.toBeNull();
    const c = insertCall as unknown as { sql: string; params: unknown[] };
    expect(c.sql).toContain('INSERT INTO class_types');
    expect(c.sql).toContain('category');
    // Bindings: id, tenant_id, name, category, duration_minutes, default_capacity, color, created_at
    expect(c.params[1]).toBe('a'); // tenant_id = studio.id
    expect(c.params[2]).toBe('Vinyasa Flow');
    expect(c.params[3]).toBe('yoga'); // category slug
    expect(c.params[4]).toBe(60); // default duration
    expect(c.params[5]).toBe(20); // default capacity
    expect(c.params[6]).toBe('#6366f1'); // default color
    expect(typeof c.params[0]).toBe('string'); // UUID
    expect(typeof c.params[7]).toBe('number'); // created_at
  });

  test('class form requires a category', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
    });
    let executed = false;
    await page.route(STUDIO_API_EXECUTE, (route) => {
      executed = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/yoga-haus/admin');
    await page.fill('#class-name', 'Test');
    // Don't pick a category. HTML5 required on <select> will block submit;
    // status banner won't appear. We just assert no INSERT happened.
    await page.getByRole('button', { name: /Add class type/i }).click();
    await page.waitForTimeout(150);
    expect(executed).toBe(false);
  });

  test('category dropdown lists Mindbody-style categories', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
    });
    await page.goto('/yoga-haus/admin');
    const options = page.locator('#class-category option');
    // 16 categories + the disabled placeholder
    await expect(options).toHaveCount(17);
    await expect(page.locator('#class-category option[value=yoga]')).toHaveText('Yoga');
    await expect(page.locator('#class-category option[value=hiit]')).toHaveText('HIIT');
    await expect(page.locator('#class-category option[value=pilates]')).toHaveText('Pilates');
  });

  test('class card shows the category label', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      classes: [
        { id: 'c1', name: 'Vinyasa', category: 'yoga', duration_minutes: 60, default_capacity: 20, color: '#fff' },
      ],
    });
    await page.goto('/yoga-haus/admin');
    await expect(page.locator('.class-category').first()).toHaveText('Yoga');
  });

  test('rejects invalid duration', async ({ page }) => {
    await signedIn(page);
    await setupOwnerCheck(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
    });
    let executed = false;
    await page.route(STUDIO_API_EXECUTE, (route) => {
      executed = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/yoga-haus/admin');
    await page.fill('#class-name', 'Test');
    await page.selectOption('#class-category', 'yoga');
    await page.fill('#class-duration', '9999');
    await page.getByRole('button', { name: /Add class type/i }).click();

    await expect(page.locator('#admin-status')).toContainText(/Duration must be/);
    expect(executed).toBe(false);
  });

  test('Delete class type sends DELETE scoped to tenant_id', async ({ page }) => {
    let deleteCall: { sql: string; params: unknown[] } | null = null;
    let classQueryCount = 0;
    await signedIn(page);
    await page.unroute(STUDIO_API_QUERY);
    await page.route(STUDIO_API_QUERY, async (route) => {
      const body = JSON.parse(route.request().postData()!) as { sql: string };
      if (body.sql.includes('FROM studios')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [{ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' }],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      classQueryCount++;
      const rows =
        classQueryCount === 1
          ? [{ id: 'c1', name: 'Vinyasa', duration_minutes: 60, default_capacity: 20, color: '#fff' }]
          : [];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows, meta: { changes: 0, duration: 0 } }),
      });
    });
    await page.route(STUDIO_API_EXECUTE, async (route) => {
      deleteCall = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ meta: { changes: 1, duration: 0, last_row_id: 0 } }),
      });
    });

    // Auto-accept the confirm() dialog
    page.on('dialog', (d) => d.accept());

    await page.goto('/yoga-haus/admin');
    await expect(page.locator('.class-card')).toHaveCount(1);
    await page.locator('.btn-class-delete').click();

    // After delete, the list reloads and shows empty state
    await expect(page.locator('#classes-empty')).toBeVisible();
    expect(deleteCall).not.toBeNull();
    const d = deleteCall as unknown as { sql: string; params: unknown[] };
    expect(d.sql).toContain('DELETE FROM class_types');
    expect(d.sql).toContain('id = ?');
    expect(d.sql).toContain('tenant_id = ?');
    expect(d.params).toEqual(['c1', 'a']);
  });
});

test.describe('schedules + upcoming sessions', () => {
  function adminRouter(
    page: import('@playwright/test').Page,
    opts: {
      studio: Record<string, unknown>;
      classes?: Record<string, unknown>[];
      schedules?: Record<string, unknown>[];
      sessions?: Record<string, unknown>[];
      onScheduleQueryCall?: () => void;
      onSessionQueryCall?: () => void;
    },
  ) {
    return page.route(STUDIO_API_QUERY, (route) => {
      const body = JSON.parse(route.request().postData()!) as { sql: string };
      if (body.sql.includes('FROM studios')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [opts.studio],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      if (body.sql.includes('FROM class_types')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: opts.classes ?? [],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      if (body.sql.includes('FROM schedules')) {
        opts.onScheduleQueryCall?.();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: opts.schedules ?? [],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      if (body.sql.includes('FROM sessions')) {
        opts.onSessionQueryCall?.();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: opts.sessions ?? [],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      return route.fulfill({ status: 200, body: '{"rows":[]}' });
    });
  }

  test('empty state for schedules + sessions when nothing exists', async ({ page }) => {
    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
    });
    await page.goto('/yoga-haus/admin');

    await expect(page.locator('#schedules-empty')).toBeVisible();
    await expect(page.locator('#sessions-empty')).toBeVisible();
  });

  test('lists existing schedules with day labels + start time', async ({ page }) => {
    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      schedules: [
        {
          id: 's1',
          class_type_id: 'c1',
          class_name: 'Vinyasa Flow',
          class_color: '#ff0000',
          days_of_week: '1,3,5',
          start_time: '18:00',
          duration_minutes: 60,
          capacity: 20,
          location: 'Main studio',
        },
      ],
    });
    await page.goto('/yoga-haus/admin');

    const card = page.locator('.schedule-card').first();
    await expect(card).toContainText('Vinyasa Flow');
    await expect(card).toContainText('Mon, Wed, Fri at 18:00');
    await expect(card).toContainText('60 min');
    await expect(card).toContainText('cap 20');
    await expect(card).toContainText('Main studio');
  });

  test('schedule form requires a class type and at least one day', async ({ page }) => {
    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      classes: [{ id: 'c1', name: 'Vinyasa', category: 'yoga', duration_minutes: 60, default_capacity: 20, color: '#fff' }],
    });
    let executed = false;
    await page.route(STUDIO_API_EXECUTE, (route) => {
      executed = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.route(/data-wellness\.proappstore\.online\/batch/, (route) => {
      executed = true;
      return route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/yoga-haus/admin');

    // Pick class type but no days
    await page.selectOption('#schedule-class', 'c1');
    await page.getByRole('button', { name: /Add schedule/i }).click();
    await expect(page.locator('#schedule-status')).toContainText(/at least one day/);
    expect(executed).toBe(false);
  });

  test('add schedule generates sessions and posts a single batch', async ({ page }) => {
    let batchCall: { statements: { sql: string; params: unknown[] }[] } | null = null;
    let sessionQueryCount = 0;
    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      classes: [
        { id: 'c1', name: 'Vinyasa', category: 'yoga', duration_minutes: 60, default_capacity: 20, color: '#fff' },
      ],
      onSessionQueryCall: () => sessionQueryCount++,
    });
    await page.route(/data-wellness\.proappstore\.online\/batch/, async (route) => {
      batchCall = JSON.parse(route.request().postData()!);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [] }),
      });
    });

    await page.goto('/yoga-haus/admin');
    await page.selectOption('#schedule-class', 'c1');
    // Pick Mon + Wed
    await page.check('#schedule-dow input[value="1"]');
    await page.check('#schedule-dow input[value="3"]');
    // Default time 18:00 is fine
    await page.getByRole('button', { name: /Add schedule/i }).click();

    await expect(page.locator('#schedule-status')).toContainText(/Added schedule/);

    expect(batchCall).not.toBeNull();
    const b = batchCall as unknown as { statements: { sql: string; params: unknown[] }[] };
    // First statement: INSERT INTO schedules
    expect(b.statements[0].sql).toContain('INSERT INTO schedules');
    // Bindings order: id, tenant_id, class_type_id, instructor_id, days_of_week,
    // start_time, duration_minutes, capacity, location, starts_on, created_at
    expect(b.statements[0].params[3]).toBeNull(); // no instructor picked
    expect(b.statements[0].params[4]).toBe('1,3'); // Mon=1, Wed=3
    expect(b.statements[0].params[5]).toBe('18:00');
    expect(b.statements[0].params[7]).toBe(20); // capacity from class default

    // Subsequent statements: session INSERTs
    expect(b.statements.length).toBeGreaterThan(1);
    for (const s of b.statements.slice(1)) {
      expect(s.sql).toContain('INSERT INTO sessions');
      // schedule_id is the last bound param
      expect(s.params[s.params.length - 1]).toBe(b.statements[0].params[0]);
    }
  });

  test('upcoming sessions render in the 7-day week-view grid', async ({ page }) => {
    const oneHour = 60 * 60 * 1000;
    const tomorrow9am = new Date();
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);
    const tomorrow6pm = new Date(tomorrow9am);
    tomorrow6pm.setHours(18, 0, 0, 0);

    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      sessions: [
        {
          id: 'sess1',
          starts_at: tomorrow9am.getTime(),
          ends_at: tomorrow9am.getTime() + oneHour,
          capacity: 20,
          location: 'Main studio',
          status: 'scheduled',
          class_name: 'Sunrise Vinyasa',
          class_color: '#ff0000',
        },
        {
          id: 'sess2',
          starts_at: tomorrow6pm.getTime(),
          ends_at: tomorrow6pm.getTime() + oneHour,
          capacity: 15,
          location: null,
          status: 'scheduled',
          class_name: 'Evening Yin',
          class_color: '#00ff00',
        },
      ],
    });
    await page.goto('/yoga-haus/admin');

    // Week-view: 7 day columns, each with header + sessions stacked chronologically.
    const cols = page.locator('.week-col');
    await expect(cols).toHaveCount(7);
    // First column is today (highlighted).
    await expect(cols.nth(0).locator('.day-header.today')).toBeVisible();
    // Tomorrow's column has 2 sessions, sorted by time.
    const tomorrowCells = cols.nth(1).locator('.week-cell');
    await expect(tomorrowCells).toHaveCount(2);
    await expect(tomorrowCells.nth(0)).toContainText('Sunrise Vinyasa');
    await expect(tomorrowCells.nth(1)).toContainText('Evening Yin');
  });

  test('week-view cells show booking counts and are clickable', async ({ page }) => {
    const oneHour = 60 * 60 * 1000;
    const tomorrow9am = new Date();
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);

    await signedIn(page);
    await adminRouter(page, {
      studio: { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' },
      sessions: [
        {
          id: 'sess1',
          starts_at: tomorrow9am.getTime(),
          ends_at: tomorrow9am.getTime() + oneHour,
          capacity: 12,
          location: 'Main studio',
          status: 'scheduled',
          class_name: 'Sunrise Vinyasa',
          class_color: '#ff0000',
          booked: 3,
        },
      ],
    });
    await page.goto('/yoga-haus/admin');

    const cell = page.locator('.week-cell').filter({ hasText: 'Sunrise Vinyasa' });
    await expect(cell).toBeVisible();
    await expect(cell.locator('.cap')).toHaveText('3/12');
    // 0 < booked < capacity → "some" state
    await expect(cell.locator('.cap')).toHaveClass(/some/);
    // Element is a button so it's keyboard-focusable
    await expect(cell).toHaveJSProperty('tagName', 'BUTTON');
  });

  test('clicking a session cell opens the attendees panel', async ({ page }) => {
    const oneHour = 60 * 60 * 1000;
    const tomorrow9am = new Date();
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);

    await signedIn(page);

    let bookingsQueryCount = 0;
    await page.route(STUDIO_API_QUERY, (route) => {
      const body = JSON.parse(route.request().postData()!) as { sql: string; params?: unknown[] };
      if (body.sql.includes('FROM studios')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [{ id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', owner_user_id: 'gh:42' }],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      // attendees query is the only one that JOINs clients; check it before
      // the sessions branch (sessions's subselect also says `FROM bookings b`).
      if (body.sql.includes('JOIN clients c')) {
        bookingsQueryCount++;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [
              {
                id: 'b1',
                status: 'confirmed',
                booked_at: Date.now() - 3600_000,
                source: 'web',
                client_name: 'Jess Reed',
                client_email: 'jess@example.com',
                client_user_id: 'gh:101',
              },
              {
                id: 'b2',
                status: 'confirmed',
                booked_at: Date.now() - 1800_000,
                source: 'web',
                client_name: 'Sam Lee',
                client_email: null,
                client_user_id: 'gh:102',
              },
            ],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      if (body.sql.includes('FROM sessions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rows: [
              {
                id: 'sess1',
                starts_at: tomorrow9am.getTime(),
                ends_at: tomorrow9am.getTime() + oneHour,
                capacity: 10,
                location: 'Main studio',
                status: 'scheduled',
                class_name: 'Sunrise Vinyasa',
                class_color: '#7c6a5c',
                booked: 2,
              },
            ],
            meta: { changes: 0, duration: 0 },
          }),
        });
      }
      return route.fulfill({ status: 200, body: '{"rows":[]}' });
    });

    await page.goto('/yoga-haus/admin');

    // Panel starts hidden
    await expect(page.locator('#attendees-panel')).toBeHidden();

    await page.locator('.week-cell').filter({ hasText: 'Sunrise Vinyasa' }).click();

    await expect(page.locator('#attendees-panel')).toBeVisible();
    await expect(page.locator('#attendees-title')).toHaveText('Sunrise Vinyasa');
    const items = page.locator('.attendee');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Jess Reed');
    await expect(items.nth(0)).toContainText('jess@example.com');
    await expect(items.nth(1)).toContainText('Sam Lee');
    // The clicked cell is highlighted
    await expect(page.locator('.week-cell.active')).toHaveCount(1);
    expect(bookingsQueryCount).toBe(1);

    // Close button hides the panel and clears the highlight.
    await page.locator('#attendees-close').click();
    await expect(page.locator('#attendees-panel')).toBeHidden();
    await expect(page.locator('.week-cell.active')).toHaveCount(0);
  });
});

test.describe('public booking flow', () => {
  test('shows inline email sign-in form (no window.prompt) for guests', async ({ page }) => {
    await page.route(STUDIO_API_PUBLIC, (route) => {
      const url = route.request().url();
      if (url.endsWith('/public/studios/yoga-haus')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'a',
            slug: 'yoga-haus',
            name: 'Yoga Haus',
            timezone: 'Australia/Sydney',
            currency: 'AUD',
          }),
        });
      }
      return route.fulfill({ status: 200, body: '[]' });
    });

    await page.goto('/yoga-haus');

    await expect(page.locator('.public-auth-bar--signin')).toBeVisible();
    await expect(page.locator('.pa-google')).toHaveText('Continue with Google');
    await expect(page.locator('.pa-email-input')).toBeVisible();
    await expect(page.locator('.pa-email-send')).toHaveText('Send sign-in link');
    // No signed-in elements yet
    await expect(page.locator('#my-bookings-section')).toBeHidden();
  });

  test('renders my-bookings + Book buttons when signed in', async ({ page }) => {
    const oneHour = 60 * 60 * 1000;
    const tomorrow9am = new Date();
    tomorrow9am.setDate(tomorrow9am.getDate() + 1);
    tomorrow9am.setHours(9, 0, 0, 0);
    const dayAfter6pm = new Date(tomorrow9am);
    dayAfter6pm.setDate(dayAfter6pm.getDate() + 1);
    dayAfter6pm.setHours(18, 0, 0, 0);

    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(USER),
      }),
    );
    await page.addInitScript((u) => {
      localStorage.setItem('fas:session', JSON.stringify({ token: 'cached-token', user: u }));
    }, USER);

    await page.route(STUDIO_API_PUBLIC, (route) => {
      const url = route.request().url();
      if (url.endsWith('/public/studios/yoga-haus')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'a',
            slug: 'yoga-haus',
            name: 'Yoga Haus',
            timezone: 'Australia/Sydney',
            currency: 'AUD',
          }),
        });
      }
      if (url.includes('/my-bookings')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'b1',
              session_id: 'sess1',
              status: 'confirmed',
              booked_at: Date.now() - 3600_000,
              starts_at: tomorrow9am.getTime(),
              ends_at: tomorrow9am.getTime() + oneHour,
              location: 'Main studio',
              class_name: 'Sunrise Vinyasa',
              class_color: '#7c6a5c',
            },
          ]),
        });
      }
      if (url.includes('/sessions')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'sess1',
              starts_at: tomorrow9am.getTime(),
              ends_at: tomorrow9am.getTime() + oneHour,
              capacity: 12,
              location: 'Main studio',
              status: 'scheduled',
              class_name: 'Sunrise Vinyasa',
              class_color: '#7c6a5c',
            },
            {
              id: 'sess2',
              starts_at: dayAfter6pm.getTime(),
              ends_at: dayAfter6pm.getTime() + oneHour,
              capacity: 8,
              location: null,
              status: 'scheduled',
              class_name: 'Evening Yin',
              class_color: '#7c6a5c',
            },
          ]),
        });
      }
      return route.fulfill({ status: 200, body: '[]' });
    });

    await page.goto('/yoga-haus');

    // Signed-in bar (not the guest sign-in bar)
    await expect(page.locator('.public-auth-bar:not(.public-auth-bar--signin)')).toBeVisible();
    await expect(page.locator('.public-auth-bar:not(.public-auth-bar--signin)')).toContainText('alice');

    // My bookings panel renders the one booking
    await expect(page.locator('#my-bookings-section')).toBeVisible();
    const bookings = page.locator('.my-booking');
    await expect(bookings).toHaveCount(1);
    await expect(bookings.first()).toContainText('Sunrise Vinyasa');
    await expect(bookings.first()).toContainText('Main studio');
    await expect(bookings.first().locator('.btn-cancel-booking')).toBeVisible();

    // sess1 already booked → "Booked" button; sess2 not booked → "Book" button.
    const bookedBtn = page.locator('.btn-booked');
    const bookBtn = page.locator('.btn-book');
    await expect(bookedBtn).toHaveCount(1);
    await expect(bookedBtn).toHaveText('Booked');
    await expect(bookBtn).toHaveCount(1);
    await expect(bookBtn).toHaveText('Book');
  });
});

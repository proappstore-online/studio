import { expect, test, type Route } from '@playwright/test';

const FAS_API = 'https://api.freeappstore.online';
const PAS_API_GENERATE = 'https://api.proappstore.online/v1/ai/generate';
const STUDIO_API_QUERY = /data-studio\.proappstore\.online\/query/;
const STUDIO_API_EXECUTE = /data-studio\.proappstore\.online\/execute/;
const STUDIO_API_PUBLIC = /data-studio\.proappstore\.online\/public\/studios/;

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
    // Bindings order: id, slug, name, description, owner_user_id, timezone, currency, created_at
    expect(captured.params[1]).toBe('yoga-haus'); // slug derived from name
    expect(captured.params[2]).toBe('Yoga Haus'); // name
    expect(captured.params[3]).toBe('Warm room, warmer people.'); // description
    expect(captured.params[4]).toBe('gh:42'); // owner = signed-in user.id
    expect(captured.params[5]).toBe('Australia/Sydney');
    expect(captured.params[6]).toBe('AUD'); // currency upper-cased
    expect(typeof captured.params[0]).toBe('string'); // UUID id
    expect(typeof captured.params[7]).toBe('number'); // created_at ms
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

  test('Each card has a "View public page →" link pointing at /<slug>', async ({ page }) => {
    await signedIn(page, {
      studios: [
        { id: 'a', slug: 'yoga-haus', name: 'Yoga Haus', description: null, timezone: 'UTC', currency: 'AUD', created_at: 1 },
      ],
    });
    await page.goto('/');
    const link = page.locator('.studio-card a').first();
    await expect(link).toHaveText(/View public page/);
    await expect(link).toHaveAttribute('href', '/yoga-haus');
    await expect(link).toHaveAttribute('target', '_blank');
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

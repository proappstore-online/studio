import { expect, test } from '@playwright/test';

const FAS_API = 'https://api.freeappstore.online';

test.describe('studio sign-in page', () => {
  test('renders title, lede, and both sign-in surfaces', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/studio/);
    await expect(page.getByRole('heading', { name: 'studio' })).toBeVisible();
    await expect(page.getByText(/Book classes, manage clients/)).toBeVisible();

    // Both form + OAuth are visible on initial load
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: /Email me a sign-in link/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();

    // Signed-in view is pre-rendered but hidden — Bitwarden-friendly toggle
    // (no innerHTML rewrites later).
    await expect(page.locator('#signed-in-view')).toBeHidden();
  });

  test('email input has the attributes password managers expect', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#email');
    await expect(input).toHaveAttribute('name', 'email');
    await expect(input).toHaveAttribute('type', 'email');
    await expect(input).toHaveAttribute('autocomplete', 'email');
    await expect(input).toHaveAttribute('required', '');

    // The <form> has a real action+method so Bitwarden recognizes it as a
    // credential form; JS preventDefault handles the actual submit.
    const form = page.locator('#email-form');
    await expect(form).toHaveAttribute('method', 'post');
    await expect(form).toHaveAttribute('action', /\/v1\/auth\/email\/start$/);
  });
});

test.describe('OAuth redirect construction', () => {
  for (const { id, provider } of [
    { id: 'btn-google', provider: 'google' },
    { id: 'btn-github', provider: 'github' },
  ] as const) {
    test(`${provider} button navigates to FAS /v1/auth/${provider}/start with appId+returnTo`, async ({ page }) => {
      // Intercept the top-level navigation to FAS so we can inspect the URL
      // without actually following the redirect chain into a real OAuth flow.
      let captured: string | null = null;
      await page.route(`${FAS_API}/v1/auth/${provider}/start*`, async (route) => {
        captured = route.request().url();
        // Respond with empty 200 so the navigation completes without
        // leaving the test page (no real OAuth redirect occurs).
        await route.fulfill({ status: 200, contentType: 'text/html', body: '' });
      });

      await page.goto('/');
      await page.locator(`#${id}`).click();
      await expect.poll(() => captured).not.toBeNull();

      const url = new URL(captured!);
      expect(url.origin).toBe(FAS_API);
      expect(url.pathname).toBe(`/v1/auth/${provider}/start`);
      expect(url.searchParams.get('app_id')).toBe('studio');
      const ret = url.searchParams.get('return_to');
      expect(ret).toBeTruthy();
      expect(ret).not.toContain('#');
    });
  }
});

test.describe('email magic-link form', () => {
  test('shows an error banner when the API returns non-2xx (e.g. 503)', async ({ page }) => {
    await page.route(`${FAS_API}/v1/auth/email/start`, (route) =>
      route.fulfill({ status: 503, body: 'Email auth not configured' }),
    );
    await page.goto('/');
    await page.fill('#email', 'alice@example.com');
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click();

    const status = page.locator('#status');
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/err/);
    await expect(status).toContainText(/503/);
    await expect(status).toContainText(/Email auth not configured/);
  });

  test('shows a check-your-inbox confirmation on 200', async ({ page }) => {
    await page.route(`${FAS_API}/v1/auth/email/start`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),
    );
    await page.goto('/');
    await page.fill('#email', 'alice@example.com');
    await page.getByRole('button', { name: /Email me a sign-in link/i }).click();

    const status = page.locator('#status');
    await expect(status).toBeVisible();
    await expect(status).toHaveClass(/ok/);
    await expect(status).toContainText(/Check your inbox/);
  });

  test('does not submit when email field is empty', async ({ page }) => {
    let called = false;
    await page.route(`${FAS_API}/v1/auth/email/start`, (route) => {
      called = true;
      return route.fulfill({ status: 200, body: '{"ok":true}' });
    });
    await page.goto('/');
    // Submit form programmatically since HTML5 required validation would
    // otherwise block the click on an empty input.
    await page.locator('#email-form').evaluate((f) =>
      (f as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true })),
    );
    // Give the route a chance to fire if it was going to.
    await page.waitForTimeout(200);
    expect(called).toBe(false);
  });
});

test.describe('cached session', () => {
  test('shows signed-in view immediately when a valid session is cached', async ({ page }) => {
    // Stub /auth/me to validate the cached token.
    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'gh:42', login: 'alice', avatarUrl: null }),
      }),
    );

    // Inject session into localStorage BEFORE the page's module script runs.
    await page.addInitScript(() => {
      localStorage.setItem(
        'fas:session',
        JSON.stringify({
          token: 'cached-token',
          user: { id: 'gh:42', login: 'alice', avatarUrl: null },
        }),
      );
    });

    await page.goto('/');

    await expect(page.locator('#signed-in-view')).toBeVisible();
    await expect(page.locator('#signin-view')).toBeHidden();
    await expect(page.locator('#who-name')).toHaveText('alice');
    // Avatar falls back to the initial when avatarUrl is null.
    await expect(page.locator('#avatar')).toHaveText('A');
  });

  test('sign-out clears the cache and returns to sign-in view', async ({ page }) => {
    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'gh:42', login: 'alice', avatarUrl: null }),
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        'fas:session',
        JSON.stringify({
          token: 'cached-token',
          user: { id: 'gh:42', login: 'alice', avatarUrl: null },
        }),
      );
    });
    await page.goto('/');
    await expect(page.locator('#signed-in-view')).toBeVisible();

    await page.locator('#btn-signout').click();

    await expect(page.locator('#signin-view')).toBeVisible();
    await expect(page.locator('#signed-in-view')).toBeHidden();
    const cached = await page.evaluate(() => localStorage.getItem('fas:session'));
    expect(cached).toBeNull();
  });

  test('clears stale cache when /auth/me rejects the cached token', async ({ page }) => {
    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({ status: 401, body: 'invalid or expired session' }),
    );
    await page.addInitScript(() => {
      localStorage.setItem(
        'fas:session',
        JSON.stringify({
          token: 'stale',
          user: { id: 'gh:42', login: 'alice', avatarUrl: null },
        }),
      );
    });
    await page.goto('/');

    // After the failed /auth/me, the cache should be wiped and we stay on
    // the sign-in view (the cached user is not shown).
    await expect(page.locator('#signin-view')).toBeVisible();
    const cached = await page.evaluate(() => localStorage.getItem('fas:session'));
    expect(cached).toBeNull();
  });
});

test.describe('OAuth post-redirect session capture', () => {
  test('captures #fas_session= from the hash and shows signed-in view', async ({ page }) => {
    await page.route(`${FAS_API}/v1/auth/me`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'google:abc', login: 'bob', avatarUrl: null }),
      }),
    );

    await page.goto('/#fas_session=fresh-token');

    await expect(page.locator('#signed-in-view')).toBeVisible();
    await expect(page.locator('#who-name')).toHaveText('bob');

    // Hash is cleared so reload doesn't re-run the capture with a stale token.
    expect(page.url()).not.toContain('#fas_session=');

    // Session is persisted to localStorage for subsequent loads.
    const cached = await page.evaluate(() => localStorage.getItem('fas:session'));
    expect(cached).toContain('fresh-token');
  });
});

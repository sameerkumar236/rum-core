import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

async function login(page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@rumcore.dev');
  await page.getByLabel('Password', { exact: true }).fill('DemoPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function logout(page) {
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('seeded monitoring dashboard and every navigation screen render without browser errors', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await expect(page.locator('.metric-value').first()).not.toHaveText('0');
  await page.screenshot({
    path: '.local/dashboard-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });

  const screens = [
    ['Pages', '/pages'],
    ['Endpoints', '/endpoints'],
    ['Geography', '/geography'],
    ['Environment', '/environment'],
    ['Projects', '/projects'],
    ['Usage', '/usage'],
    ['Settings', '/settings'],
  ];
  for (const [label, route] of screens) {
    await page.locator('.sidebar').getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(
      page.getByRole('heading', { level: 1, name: label, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.locator('.topbar').getByRole('link', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Connect Your Site', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await logout(page);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});

test('new account, actual telemetry, CSV export, settings and deletion work end to end', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Browser Tester');
  await page.getByLabel('Email address').fill(`browser-${Date.now()}@example.test`);
  await page.getByLabel(/^Password/).fill('BrowserPass123!');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByText('Your first insight starts here')).toBeVisible();

  await page.getByRole('link', { name: 'Create a project', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByLabel('Project name', { exact: true }).fill('Browser QA');
  await createDialog.getByLabel('Website origin').fill('http://127.0.0.1:4173');
  await createDialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(createDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser QA', exact: true })).toBeVisible();
  const project = await page.evaluate(async () => {
    const response = await fetch('/api/projects');
    return (await response.json()).projects.find((item) => item.name === 'Browser QA');
  });

  await page.goto('/overview');
  await expect(page.getByLabel('Current project')).toHaveValue(project.id);

  const ingest = await page.evaluate(async (key) => {
    const common = {
      sessionId: 'browser-qa',
      pageUrl: `${location.origin}/checkout?secret=hidden`,
      browser: 'Chrome',
      device: 'Desktop',
      os: 'Windows',
      connection: '4g',
      timestamp: Date.now(),
    };
    const response = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key,
        events: [
          { ...common, id: 'page-qa', type: 'page', lcp: 1700, fcp: 900, cls: 0.04, inp: 120 },
          {
            ...common,
            id: 'req-qa',
            type: 'request',
            url: `${location.origin}/api/orders/123?token=hidden`,
            method: 'POST',
            status: 500,
            duration: 450,
            ttfb: 200,
          },
        ],
      }),
    });
    return { status: response.status, text: await response.text() };
  }, project.key);
  expect(ingest.status).toBe(202);

  await page.getByRole('button', { name: 'Refresh analytics' }).click();
  await expect(page.locator('.metric-value').first()).toHaveText('1');
  await page.locator('.sidebar').getByRole('link', { name: 'Endpoints', exact: true }).click();
  await expect(page.getByText('/api/orders/:id', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('hidden')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('requests');

  const csv = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/export?range=24h&kind=requests`);
    return {
      status: response.status,
      text: await response.text(),
      type: response.headers.get('content-type'),
    };
  }, project.id);
  expect(csv.status).toBe(200);
  expect(csv.type).toContain('text/csv');
  expect(csv.text).toContain('/api/orders/:id');
  expect(csv.text).not.toContain('hidden');

  await page.locator('.sidebar').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByLabel('Project name', { exact: true }).fill('Updated Browser QA');
  await page.getByLabel('Collect Web Vitals').uncheck();
  await page.getByLabel('URL collection rules').selectOption('exclude');
  await page.getByLabel('URL patterns').fill('/health');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Project settings saved.', { exact: false })).toBeVisible();
  const changed = await page.request.get(`/api/projects/${project.id}`);
  expect((await changed.json()).project.collectVitals).toBe(false);

  await page.getByRole('button', { name: 'Rotate key', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Rotate key', exact: true })
    .click();
  await expect(page.getByText('Tracking key rotated.', { exact: false })).toBeVisible();
  const rotated = await page.request.get(`/api/projects/${project.id}`);
  expect((await rotated.json()).project.key).not.toBe(project.key);

  await page.locator('.sidebar').getByRole('link', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Updated Browser QA', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Updated Browser QA');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete project', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Updated Browser QA', { exact: true })).toHaveCount(0);
});

test('mobile navigation works without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  await openNavigation.click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(openNavigation).toBeFocused();
  await openNavigation.click();
  await page.locator('.sidebar').getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(page).toHaveURL(/\/pages$/);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.screenshot({
    path: '.local/dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(hasOverflow).toBe(false);

  const accountButton = page.getByRole('button', { name: 'Open account menu', exact: true });
  await accountButton.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menu')).toContainText('demo@rumcore.dev');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(accountButton).toBeFocused();
  await logout(page);
});

test('light and dark themes change the UI and persist through reload and sign-in', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await login(page);
  const root = page.locator('html');
  await expect(root).not.toHaveClass(/\bdark\b/);
  const lightBackground = await root.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.screenshot({
    path: '.local/dashboard-light.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(root).toHaveClass(/\bdark\b/);
  await expect
    .poll(() => root.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(lightBackground);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rum-theme'))).toBe('dark');
  await page.screenshot({
    path: '.local/dashboard-dark.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(root).toHaveClass(/\bdark\b/);
  await logout(page);
  await expect(root).toHaveClass(/\bdark\b/);
  await login(page);
  await expect(root).toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(root).not.toHaveClass(/\bdark\b/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('rum-theme')))
    .toBe('light');
  await expect
    .poll(() => root.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe(lightBackground);
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(root).not.toHaveClass(/\bdark\b/);
  await logout(page);
  await expect(root).not.toHaveClass(/\bdark\b/);
  await login(page);
  await expect(root).not.toHaveClass(/\bdark\b/);
});

test('detail navigation, time ranges, project filter reset and expired-session recovery work', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('combobox', { name: /^Time range/ }).selectOption('7d');
  await page.locator('.sidebar').getByRole('link', { name: 'Pages', exact: true }).click();
  await page.locator('.table-url').first().click();
  await expect(page).toHaveURL(/pageUrl=/);
  await page.getByRole('link', { name: 'All pages', exact: true }).click();
  await expect(page).toHaveURL(/\/pages$/);
  await page.locator('.sidebar').getByRole('link', { name: 'Geography', exact: true }).click();
  await page.getByRole('combobox', { name: /^Country/ }).selectOption('US');
  await page.getByLabel('Current project').selectOption({ index: 2 });
  await expect(page.getByRole('combobox', { name: /^Country/ })).toHaveValue('');
  await page
    .locator('.sidebar')
    .getByRole('link', { name: 'Environment', exact: true })
    .click();
  await page.getByRole('combobox', { name: /^Browsers/ }).selectOption('Chrome');
  await page.getByLabel('Current project').selectOption({ index: 1 });
  await expect(page.getByRole('combobox', { name: /^Browsers/ })).toHaveValue('');
  await context.clearCookies();
  await page.getByRole('button', { name: 'Refresh analytics' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
});

test('external tracker captures startup APIs while config loads and sends sanitized SPA events', async ({
  page,
  context,
}) => {
  await login(page);
  let projectKey = '';
  const website = createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ originalResponse: true }));
      return;
    }
    if (request.url === '/bootstrap.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end(
        "window.initialResponse = fetch('/api/early/456?token=hidden').then(response => response.json());",
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html lang="en"><head><title>Tracked website</title>
      <script defer src="http://127.0.0.1:4173/tracker.js" data-key="${projectKey}"
        data-endpoint="http://127.0.0.1:4173/api/ingest"></script>
      <script defer src="/bootstrap.js"></script>
      </head><body><h1>A real tracked website</h1></body></html>`);
  });
  await new Promise((resolve) => website.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${website.address().port}`;
  const tracked = await context.newPage();
  let releaseConfig;

  try {
    const created = await page.evaluate(async (origin) => {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'External SDK QA', origin }),
      });
      if (!response.ok) throw new Error(await response.text());
      return (await response.json()).project;
    }, origin);
    projectKey = created.key;
    const configGate = new Promise((resolve) => {
      releaseConfig = resolve;
    });
    await tracked.route('**/api/ingest/config?**', async (route) => {
      await configGate;
      await route.continue();
    });
    const earlyResponse = tracked.waitForResponse((response) =>
      response.url().includes('/api/early/'),
    );
    await tracked.goto(`${origin}/catalog?session=hidden`, { waitUntil: 'domcontentloaded' });
    await earlyResponse;
    expect(await tracked.evaluate(() => window.initialResponse)).toEqual({
      originalResponse: true,
    });
    const pendingAnalytics = await page.request.get(
      `/api/projects/${created.id}/analytics?range=24h`,
    );
    const pendingSummary = (await pendingAnalytics.json()).summary;
    expect(pendingSummary.pageViews).toBe(0);
    expect(pendingSummary.totalRequests).toBe(0);
    releaseConfig();
    await tracked.waitForFunction(() => Boolean(window.RumCore));
    const original = await tracked.evaluate(async () => {
      const response = await fetch('/api/ping/123?token=hidden', {
        headers: { Authorization: 'private-header' },
      });
      return response.json();
    });
    expect(original).toEqual({ originalResponse: true });

    await expect
      .poll(async () => {
        await tracked.evaluate(() => window.RumCore.flush());
        const response = await page.request.get(
          `/api/projects/${created.id}/analytics?range=24h`,
        );
        return (await response.json()).summary.totalRequests;
      })
      .toBe(2);

    await tracked.evaluate(() => history.pushState({}, '', '/products/123?token=hidden'));
    await expect
      .poll(async () => {
        await tracked.evaluate(() => window.RumCore.flush());
        const response = await page.request.get(
          `/api/projects/${created.id}/analytics?range=24h`,
        );
        return (await response.json()).summary.pageViews;
      })
      .toBe(2);

    const response = await page.request.get(`/api/projects/${created.id}/analytics?range=24h`);
    const data = await response.json();
    expect(data.endpoints.map((item) => item.url)).toEqual(
      expect.arrayContaining([`${origin}/api/early/:id`, `${origin}/api/ping/:id`]),
    );
    expect(data.pages.map((item) => item.pageUrl)).toContain(`${origin}/products/:id`);
    expect(JSON.stringify(data)).not.toContain('hidden');
    expect(JSON.stringify(data)).not.toContain('private-header');
    expect(data.geography[0].country).toBe('Unknown');
    await page.request.delete(`/api/projects/${created.id}`);
  } finally {
    releaseConfig?.();
    await tracked.close();
    await new Promise((resolve) => website.close(resolve));
  }
});

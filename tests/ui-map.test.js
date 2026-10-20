import { test, expect } from '@playwright/test';

test('country map matches real page-view totals and supports zoom, reset, and both themes', async ({
  page,
}) => {
  const externalRequests = [];
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(request.url());
    }
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@rumcore.dev');
  await page.getByLabel('Password', { exact: true }).fill('DemoPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.metric-value').first()).not.toHaveText('0');

  const projectResponse = await page.request.get('/api/projects');
  expect(projectResponse.ok()).toBe(true);
  const { projects } = await projectResponse.json();
  await expect(page.getByLabel('Current project')).not.toHaveValue('');
  const projectId = await page.getByLabel('Current project').inputValue();
  expect(projects.some((project) => project.id === projectId)).toBe(true);

  // Compare the SVG to the real response rendered by this page, avoiding a different
  // moving time window from a second analytics request.
  const analyticsResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/projects/${projectId}/analytics?range=24h`) &&
      response.status() === 200,
  );
  await page.locator('.sidebar').getByRole('link', { name: 'Pages', exact: true }).click();
  const analytics = await (await analyticsResponse).json();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pages', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Time range', exact: true })).toHaveValue(
    '24h',
  );

  const map = page.locator('.world-map');
  await expect(map).toBeVisible();
  const representedCountries = new Set(
    await map
      .locator('[data-country]')
      .evaluateAll((paths) => paths.map((path) => path.dataset.country)),
  );
  const totals = new Map();
  for (const row of analytics.geography) {
    if (row.pageViews > 0 && representedCountries.has(row.country)) {
      totals.set(row.country, (totals.get(row.country) || 0) + row.pageViews);
    }
  }

  for (const country of ['IN', 'US']) {
    expect(
      totals.get(country),
      `${country} should have seeded page views in the selected range`,
    ).toBeGreaterThan(0);
    await expect(map.locator(`svg [data-country="${country}"]`)).toHaveAttribute(
      'data-value',
      String(totals.get(country)),
    );
  }
  await expect(map.locator('.world-map-active')).toHaveCount(totals.size);

  const drawing = map.locator('svg > g');
  const originalTransform = await drawing.getAttribute('transform');
  expect(originalTransform).toBeTruthy();
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(drawing).not.toHaveAttribute('transform', originalTransform);
  const zoomedTransform = await drawing.getAttribute('transform');
  const zoomedScale = Number(zoomedTransform.match(/scale\(([\d.]+)\)/)?.[1]);
  expect(zoomedScale).toBeGreaterThan(1);
  await map.getByRole('button', { name: 'Reset map', exact: true }).click();
  await expect(drawing).toHaveAttribute('transform', originalTransform);

  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await page.screenshot({
    path: '.local/pages-light.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(map.locator('svg [data-country="IN"]')).toHaveAttribute(
    'data-value',
    String(totals.get('IN')),
  );
  await page.screenshot({
    path: '.local/pages-dark.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.projects-table tbody tr')).toHaveCount(projects.length);
  await page.screenshot({
    path: '.local/projects-ui.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Pages', exact: true }).click();
  await expect(map).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
  ).toBe(false);
  await page.screenshot({
    path: '.local/pages-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Welcome back', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: '.local/login-ui.png',
    fullPage: true,
    animations: 'disabled',
  });

  expect(browserErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

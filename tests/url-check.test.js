import { test, expect } from '@playwright/test';
import { urlCheckResult } from './fixtures/url-check.js';

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('demo@rumcore.dev');
  await page.getByLabel('Password', { exact: true }).fill('DemoPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

test('empty Overview explains setup and opens the project scan without starting it automatically', async ({
  page,
}) => {
  await signIn(page);
  const created = await page.request.post('/api/projects', {
    data: { name: 'Unconnected website', origin: 'https://lms.example.org' },
  });
  expect(created.ok()).toBe(true);
  const { project } = await created.json();
  await page.evaluate((id) => localStorage.setItem('rum-project', id), project.id);
  await page.goto('/overview');
  const setup = page.getByRole('region', { name: 'Monitoring setup' });
  await expect(setup).toBeInViewport();
  await expect(setup).toContainText('No tracker events in this time range');
  await expect(
    setup.getByRole('link', { name: 'Install tracker', exact: true }),
  ).toHaveAttribute('href', '/install');

  let scanRequests = 0;
  await page.route('**/api/website-check', async (route) => {
    scanRequests += 1;
    await route.fulfill({ json: urlCheckResult('browser') });
  });
  await setup.getByRole('link', { name: 'Scan this website', exact: true }).click();
  await expect(page.getByLabel('URL to check')).toHaveValue(project.origin);
  await expect(
    page.getByRole('radio', { name: 'Website API scan', exact: true }),
  ).toBeChecked();
  expect(scanRequests).toBe(0);
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Website scan fixture', exact: true }),
  ).toBeVisible();
  expect(scanRequests).toBe(1);

  const analytics = await page.request.get(`/api/projects/${project.id}/analytics?range=24h`);
  const { summary } = await analytics.json();
  expect(summary.pageViews).toBe(0);
  expect(summary.totalRequests).toBe(0);
  await page.request.delete(`/api/projects/${project.id}`);
});

test('URL checker works without projects and renders both modes and network filters', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('URL Checker Tester');
  await page.getByLabel('Email address').fill(`url-check-${Date.now()}@example.test`);
  await page.getByLabel(/^Password/).fill('BrowserPass123!');
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
  await expect(page.getByText('Your first insight starts here')).toBeVisible();

  const submitted = [];
  await page.route('**/api/website-check', async (route) => {
    const body = route.request().postDataJSON();
    submitted.push(body);
    await route.fulfill({ json: urlCheckResult(body.mode) });
  });
  await page
    .locator('.sidebar')
    .getByRole('link', { name: 'URL checker', exact: true })
    .click();
  await expect(page).toHaveURL(/\/website-check$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Website Check', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('URL to check')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Time range/ })).toHaveCount(0);
  expect(submitted).toHaveLength(0);

  await page.getByRole('radio', { name: 'API / URL check', exact: true }).check();
  await page.getByLabel('URL to check').fill('api.example.org/products');
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'API check fixture', exact: true }),
  ).toBeVisible();
  expect(submitted[0]).toEqual({ mode: 'http', url: 'https://api.example.org/products' });
  await expect(
    page.getByText('https://api.example.org/products', { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browser measurements' })).toHaveCount(0);

  await page.getByRole('radio', { name: 'Website API scan', exact: true }).check();
  await page.getByLabel('URL to check').fill('https://shop.example.org/');
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Website scan fixture', exact: true }),
  ).toBeVisible();
  expect(submitted[1]).toEqual({ mode: 'browser', url: 'https://shop.example.org/' });
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(
    page.getByText('https://shop.example.org/api/products', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^All requests/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.screenshot({
    path: '.local/url-checker-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
});

test('URL checker handles an empty API list, a blocked URL and an unavailable browser', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/website-check');
  let response = {
    status: 200,
    json: urlCheckResult('browser', {
      requests: [],
      network: { totalRequests: 0, failedRequests: 0, transferredBytes: 0 },
    }),
  };
  await page.route('**/api/website-check', (route) => route.fulfill(response));
  await page.getByLabel('URL to check').fill('https://shop.example.org/');
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No fetch/XHR calls were captured' }),
  ).toBeVisible();

  response = {
    status: 400,
    json: { message: 'Local, private, and reserved network addresses cannot be checked.' },
  };
  await page.getByLabel('URL to check').fill('http://127.0.0.1/');
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('cannot be checked');

  response = {
    status: 503,
    json: { message: 'Browser unavailable. Use API / URL check or install Chrome.' },
  };
  await page.getByLabel('URL to check').fill('https://shop.example.org/');
  await page.getByRole('button', { name: 'Run check', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Browser unavailable');
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  expect(overflow).toBe(false);
});

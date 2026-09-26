import { test, expect } from '@playwright/test';

// Use the normal development server, including Vite prebundling, with no API fixtures.
// A runtime import error can prevent Angular from bootstrapping on either route.
for (const route of ['/', '/planner']) {
  test(`startup: ${route} renders without JavaScript module errors`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => {
      if (request.resourceType() === 'script') errors.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    await page.goto(route);
    await expect(page.locator(route === '/' ? 'app-home-page' : 'app-planner-page')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(route === '/' ? 'home-loaded.png' : 'planner-loaded.png'), fullPage: true });
  });
}

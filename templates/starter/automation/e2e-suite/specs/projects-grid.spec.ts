// Example e2e spec — every approved MVP screen/interaction becomes an assertion.
// TODO: replace with specs generated from your approved MVP / preview.html.
import { test, expect } from '@playwright/test';

test.describe('Projects grid (mirrors approved MVP)', () => {
  test('shows the projects grid with status chips', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /projects/i })).toBeVisible();
    // TODO: assert the Status column + chips once the app renders them.
  });

  test('can open the new-project action', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible();
  });
});

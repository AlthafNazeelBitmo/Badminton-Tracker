import { expect, test } from '@playwright/test';

/**
 * The journey that matters: sign up, record a match in the fewest possible actions,
 * and see it reflected in the analytics. If this passes, the product does its job.
 */

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

const PASSWORD = 'end-to-end-test-password-1';

test.describe('new user journey', () => {
  test('registers, records a match, and sees it in the analytics', async ({ page }) => {
    const email = uniqueEmail();

    // --- Register --------------------------------------------------------
    await page.goto('/register');
    await page.getByLabel('Name').fill('E2E Player');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/record/);
    await expect(page.getByRole('heading', { name: 'Record a match' })).toBeVisible();

    // --- Record a singles match ------------------------------------------
    await page.getByRole('button', { name: /^Singles/ }).click();

    await page.getByLabel('Search or add opponent').fill('Rival Player');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: /Remove Rival Player/ })).toBeVisible();

    await page.getByLabel('Game 1, your score').fill('21');
    await page.getByLabel('Game 1, their score').fill('18');
    await page.getByLabel('Game 2, your score').fill('21');
    await page.getByLabel('Game 2, their score').fill('16');

    await expect(page.getByText('Win 2–0 in games')).toBeVisible();

    await page.getByRole('button', { name: 'Save match' }).click();
    await expect(page.getByText(/Recorded as a win/i)).toBeVisible();

    // --- It appears in the history ---------------------------------------
    await page.goto('/matches');
    await expect(page.getByText('Rival Player').first()).toBeVisible();
    await expect(page.getByText('21–18, 21–16')).toBeVisible();

    // --- And in the analytics --------------------------------------------
    await page.goto('/');
    const winRateTile = page.locator('.card', { hasText: 'Win rate' }).first();
    await expect(winRateTile).toContainText('100.0%');
    await expect(winRateTile).toContainText('1W');
  });

  test('rejects an impossible score before saving', async ({ page }) => {
    const email = uniqueEmail();

    await page.goto('/register');
    await page.getByLabel('Name').fill('Validation Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/record/);

    await page.getByRole('button', { name: /^Singles/ }).click();
    await page.getByLabel('Search or add opponent').fill('Someone');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // 21-20 cannot happen: past 20 you must win by two.
    await page.getByLabel('Game 1, your score').fill('21');
    await page.getByLabel('Game 1, their score').fill('20');

    await expect(page.locator('form').getByRole('alert').first()).toContainText('not reachable');
    await expect(page.getByRole('button', { name: 'Save match' })).toBeDisabled();
  });
});

test.describe('authentication', () => {
  test('sends a signed-out visitor to the login page', async ({ page }) => {
    await page.goto('/matches');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('reports bad credentials without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.test');
    await page.getByLabel('Password').fill('not-the-right-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Scoped to the form: Next.js renders its own empty role="alert" route announcer.
    await expect(page.locator('form').getByRole('alert')).toContainText(
      'Email or password is incorrect',
    );
  });
});

test.describe('accessibility basics', () => {
  test('every page has one h1 and a working skip link', async ({ page }) => {
    const email = uniqueEmail();
    await page.goto('/register');
    await page.getByLabel('Name').fill('A11y Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/record/);

    for (const path of ['/', '/matches', '/analytics', '/opponents', '/goals', '/records']) {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
    }
  });
});

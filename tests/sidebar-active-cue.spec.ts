import { test, expect, type Page } from '@playwright/test';

const ACTIVE_CUE = '[data-testid="sidebar-active-cue"]';

async function signInAsGuest(page: Page) {
  const guestUser = {
    uid: `guest-test-${Date.now()}`,
    displayName: 'Guest User',
    email: 'guest@recall-x247.local',
    photoURL: null,
    isAnonymous: true,
    isGuest: true,
  };

  // Seed guest auth + onboarding-dismissed flag before any app code runs.
  // Without the onboarded flag, the tour overlay intercepts sidebar clicks.
  await page.addInitScript((payload) => {
    window.localStorage.setItem('recall-guest-user', payload.guest);
    window.localStorage.setItem('recall-x247-onboarded', '1');
  }, { guest: JSON.stringify(guestUser) });

  // Sidebar cue is purely client-side; stub the inbox count so the test
  // does not depend on backend availability.
  await page.route('**/memories/inbox-count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"capped":false}' })
  );
}

async function gotoAuthed(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('.desktop-sidebar')).toBeVisible();
  // The splash overlay intercepts pointer events until React hides it.
  await page.waitForFunction(() => {
    const el = document.getElementById('x247-splash');
    if (!el) return true;
    const cs = window.getComputedStyle(el);
    return el.classList.contains('hide')
      || cs.visibility === 'hidden'
      || cs.display === 'none'
      || cs.pointerEvents === 'none';
  }, undefined, { timeout: 15_000 });
}

async function collapseSidebar(page: Page) {
  // Scope to the desktop sidebar; the mobile drawer renders the same
  // header but its collapse handler is a no-op.
  const sidebar = page.locator('.desktop-sidebar');
  await sidebar.getByTestId('sidebar-collapse-toggle').click();
  await expect(sidebar.getByTestId('sidebar-expand-toggle')).toBeVisible();
}

test.describe('Collapsed sidebar — "you are here" cue', () => {
  test('shows the active-page cue when collapsed and updates as the route changes', async ({ page }) => {
    await signInAsGuest(page);
    await gotoAuthed(page, '/dashboard');

    const sidebar = page.locator('.desktop-sidebar');
    const cue = sidebar.locator(ACTIVE_CUE);

    await expect(cue).toHaveCount(0);

    await collapseSidebar(page);
    await expect(cue).toBeVisible();
    await expect(cue).toHaveAttribute('aria-label', 'Current page: Dashboard');

    // Use the in-app nav button so SPA state (collapse) survives the route change.
    await sidebar.getByRole('button', { name: /^Library/ }).click();
    await expect(page).toHaveURL(/\/library/);
    await expect(sidebar.getByTestId('sidebar-expand-toggle')).toBeVisible();
    await expect(cue).toBeVisible();
    await expect(cue).toHaveAttribute('aria-label', 'Current page: Library');
  });

  test('does not render the cue while the sidebar is expanded', async ({ page }) => {
    await signInAsGuest(page);
    await gotoAuthed(page, '/dashboard');

    const sidebar = page.locator('.desktop-sidebar');

    await expect(sidebar.getByTestId('sidebar-collapse-toggle')).toBeVisible();
    await expect(sidebar.locator(ACTIVE_CUE)).toHaveCount(0);

    await page.goto('/library');
    await expect(sidebar.getByTestId('sidebar-collapse-toggle')).toBeVisible();
    await expect(sidebar.locator(ACTIVE_CUE)).toHaveCount(0);
  });
});

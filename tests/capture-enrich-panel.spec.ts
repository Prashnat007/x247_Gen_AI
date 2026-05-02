import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * W1 capture-enrichment — EnrichPanel smoke test.
 *
 * Stubs the capture preview + save endpoints so the test runs without
 * a backend. Verifies the 6 enrichment chips render, that clicking a
 * chip expands its inline editor, and that the Save flow bundles the
 * user-accepted enrichments into the /capture/save-bundle payload.
 */

const TEST_URL = 'https://example.com/some-article';

const PREVIEW_MEMORY = {
  id: '',
  title: 'Test Article About Productivity',
  summary: 'A short summary used for the EnrichPanel smoke test.',
  key_points: ['Insight one', 'Insight two'],
  tags: ['productivity', 'test'],
  domain: 'example.com',
  source_type: 'web',
  source_url: TEST_URL,
  created_at: new Date().toISOString(),
  executive_summary: 'Executive summary line.',
  action_items: [],
  glossary: [],
  study_questions: [],
  // W1 — AI suggestion seeds. Presence of any of these auto-expands
  // the EnrichPanel on mount.
  suggested_folder_hint: 'Productivity Reading',
  suggested_tasks: [
    { title: 'Try the new technique', priority: 'medium' },
    { title: 'Share with team',       priority: 'low'    },
  ],
  suggested_event: null,
  suggested_habit_link: null,
  suggested_revisit: { frequency: 'weekly', next_due: '' },
};

async function signInAsGuest(page: Page) {
  const guestUser = {
    uid: `guest-test-${Date.now()}`,
    displayName: 'Guest User',
    email: 'guest@recall-x247.local',
    photoURL: null,
    isAnonymous: true,
    isGuest: true,
  };

  await page.addInitScript((payload) => {
    window.localStorage.setItem('recall-guest-user', payload.guest);
    window.localStorage.setItem('recall-x247-onboarded', '1');
  }, { guest: JSON.stringify(guestUser) });
}

async function stubBackend(page: Page, opts: { onSaveBundle?: (body: any) => void } = {}) {
  // Sidebar inbox-count poll — always 0, no backend dependency.
  await page.route('**/memories/inbox-count', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0,"capped":false}' })
  );

  // Capture preview — returns a memory shaped to trigger the EnrichPanel
  // auto-expand path with both AI-suggested folder, tasks, and revisit.
  await page.route('**/capture', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PREVIEW_MEMORY),
    });
  });

  // Pre-save dedup check — no duplicate.
  await page.route('**/capture/dedup-check', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"duplicate":null}' })
  );

  // Folder list (FolderChip) — empty so it doesn't matter; we won't pick one.
  await page.route('**/workspace/folders/flat', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"folders":[]}' })
  );

  // Habit list — empty.
  await page.route('**/habits', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  // Related memories — empty.
  await page.route('**/memories/related', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' })
  );

  // Save bundle — capture the payload so the test can assert on it.
  await page.route('**/capture/save-bundle', (route: Route) => {
    let post: any = null;
    try { post = route.request().postDataJSON(); } catch { /* ignore */ }
    if (post && opts.onSaveBundle) opts.onSaveBundle(post);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        memory: { ...PREVIEW_MEMORY, id: 'mem-test-1' },
        memory_id: 'mem-test-1',
        created_task_ids: ['t1', 't2'],
        created_event_ids: [],
        created_revisit_ids: ['r1'],
        linked_habit_ids: [],
        linked_memory_ids: [],
        errors: [],
      }),
    });
  });

  // Auto-tag fire-and-forget — quiet 200.
  await page.route('**/memories/*/auto-tag', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"added":[]}' })
  );
}

async function gotoAuthed(page: Page, path: string) {
  await page.goto(path);
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

test.describe('W1 EnrichPanel — capture enrichment', () => {
  test('renders 6 chips, expands an editor, and bundles enrichments on Save', async ({ page }) => {
    let savedPayload: any = null;
    await signInAsGuest(page);
    await stubBackend(page, { onSaveBundle: (body) => { savedPayload = body; } });

    await gotoAuthed(page, '/capture');

    // 'web' is the default source — fill the URL input and run the pipeline.
    const urlInput = page.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
    await urlInput.fill(TEST_URL);

    await page.getByRole('button', { name: /Run 7-Agent Capture Pipeline/i }).click();

    // The preview panel renders once /capture resolves.
    const enrichPanel = page.getByTestId('enrich-panel');
    await expect(enrichPanel).toBeVisible({ timeout: 15_000 });

    // All 6 chips render. They are auto-expanded because the preview has
    // AI suggestions, so the chip buttons should be visible immediately.
    for (const key of ['folder', 'tasks', 'related', 'calendar', 'habit', 'revisit'] as const) {
      await expect(page.getByTestId(`chip-${key}`)).toBeVisible();
    }

    // Click the Tasks chip — its inline editor (TasksChip) should mount.
    await page.getByTestId('chip-tasks').click();
    // The 2 AI-suggested tasks pre-fill into rows.
    await expect(page.getByTestId('task-row-0')).toBeVisible();
    await expect(page.getByTestId('task-row-1')).toBeVisible();
    await expect(page.getByTestId('input-task-title-0')).toHaveValue('Try the new technique');

    // Switch to the Revisit chip — verify chip-swap behaviour. The Tasks
    // editor unmounts and the Revisit editor mounts in its place.
    await page.getByTestId('chip-revisit').click();
    await expect(page.getByTestId('button-revisit-weekly')).toBeVisible();
    await expect(page.getByTestId('task-row-0')).toHaveCount(0);

    // Confirm the AI's "weekly" suggestion (it pre-seeded; click again
    // to be explicit and make the chip pill render the summary).
    await page.getByTestId('button-revisit-weekly').click();

    // Save → the stub captures the request body for assertions.
    await page.getByRole('button', { name: /Save to Vault/i }).click();

    await expect.poll(() => savedPayload, { timeout: 10_000 }).not.toBeNull();

    // Memory body is forwarded.
    expect(savedPayload.memory.title).toBe('Test Article About Productivity');

    // Tasks were bundled (2 AI-suggested rows the user accepted by default).
    expect(Array.isArray(savedPayload.tasks)).toBe(true);
    expect(savedPayload.tasks.length).toBe(2);
    expect(savedPayload.tasks[0].title).toBe('Try the new technique');

    // Revisit was bundled with the user's chosen frequency.
    expect(savedPayload.revisit?.frequency).toBe('weekly');

    // Folder / event / habit / linked memories were not picked → null/undefined.
    expect(savedPayload.folder_ref).toBeNull();
    expect(savedPayload.event).toBeNull();
    expect(savedPayload.habit_link).toBeNull();
    expect(savedPayload.linked_memory_ids ?? []).toEqual([]);

    // Preview unmounts after a successful save (signals the Save flow ran).
    await expect(page.getByTestId('enrich-panel')).toHaveCount(0);
  });

  test('panel header toggle collapses and expands the chip row', async ({ page }) => {
    await signInAsGuest(page);
    await stubBackend(page);
    await gotoAuthed(page, '/capture');

    const urlInput = page.locator('input[type="url"]').first();
    await urlInput.fill(TEST_URL);
    await page.getByRole('button', { name: /Run 7-Agent Capture Pipeline/i }).click();

    await expect(page.getByTestId('enrich-panel')).toBeVisible({ timeout: 15_000 });

    // Auto-expanded on mount because the preview carried AI suggestions.
    await expect(page.getByTestId('chip-folder')).toBeVisible();

    // Collapse — chips disappear from view as the body animates out.
    await page.getByTestId('button-enrich-toggle').click();
    await expect(page.getByTestId('chip-folder')).toBeHidden();

    // Re-expand — chips return.
    await page.getByTestId('button-enrich-toggle').click();
    await expect(page.getByTestId('chip-folder')).toBeVisible();
  });
});

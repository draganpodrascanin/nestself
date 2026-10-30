/**
 * Editor UI journey — acceptance gate for the admin CMS editor (T-C1.12).
 *
 * Tags every test `@editor`. Drives only the UI. The test itself never calls
 * the API to create or change data (reads are fine for verification).
 *
 * Run:
 *   TEST_DATABASE_URL=... pnpm e2e:content -g "@editor" --reporter=line
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import {
  ADMIN_URL,
  WORKSPACE_URL,
  USERS,
  signInStaff,
  signInEmployee,
} from './helpers';
import {
  waitForEditorReady,
  typeInEditor,
  slashMenuInsert,
  markdownShortcut,
  waitForSaved,
  screenshotPath,
  TEST_IMAGE_PATH,
} from './editor-helpers';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = `http://localhost:${process.env.E2E_API_PORT ?? '4130'}`;

// ---------------------------------------------------------------------------
// @editor journey — serial, single worker
// ---------------------------------------------------------------------------

test.describe('@editor Editor journey', () => {
  test.describe.configure({ mode: 'serial' });

  let resourceId: string;
  let editorUrl: string;

  // ─── Step 1: Author signs in, opens Content, creates an article ───
  test('step 1 — author signs in and creates an article @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);

    // Navigate to Content (exact match to avoid "Skip to content")
    await page.getByRole('link', { name: 'Content', exact: true }).click();
    await page.getByRole('heading', { name: /resources/i }).waitFor({ timeout: 15_000 });

    // The seeded resources should be listed (or an empty state)
    // Click "Create resource"
    await page.getByRole('link', { name: /create resource/i }).click();
    await page.getByRole('heading', { name: /create article/i }).waitFor({ timeout: 10_000 });

    // Fill the form
    // Category — use the labelled combobox
    const categoryTrigger = page.getByRole('combobox', { name: /primary category/i });
    await categoryTrigger.click();
    await page.getByRole('option').first().click();

    // Title
    await page.getByLabel(/article title/i).fill('E2E editor journey article');

    // Submit
    await page.getByRole('button', { name: /create article/i }).click();

    // Should navigate to the editor
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });

    // Extract the resource ID from the URL
    const url = page.url();
    const match = url.match(/resources\/([^/]+)\/variants/);
    expect(match).toBeTruthy();
    resourceId = match![1]!;
    editorUrl = `${ADMIN_URL}/cms/resources/${resourceId}/variants/sr-Latn`;
  });

  // ─── Step 2: Reload the editor URL and confirm it reopens ─────────
  test('step 2 — editor reopens on direct URL @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Screenshot: empty editor
    await page.screenshot({
      path: screenshotPath('author', 'editor-empty'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });
  });

  // ─── Step 3: Build content with the slash menu (keyboard only) ────
  test('step 3 — build content with slash menu @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Type the title
    const titleInput = page.getByRole('textbox', { name: /title/i }).first();
    await titleInput.fill('E2E editor journey article');

    // Focus the editor body
    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();

    // a) Insert a heading via slash menu
    await editor.pressSequentially('/', { delay: 30 });
    await page.locator('[role="listbox"]').first().waitFor({ timeout: 5_000 });

    // Screenshot: slash menu
    await page.screenshot({
      path: screenshotPath('author', 'slash-menu'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    await page.keyboard.type('head', { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Understanding workplace stress', { delay: 15 });

    // b) Insert a paragraph via slash menu
    await slashMenuInsert(page, 'para');
    await page.keyboard.type(
      'Stress at work often goes unnoticed and affects concentration, mood and relationships.',
      { delay: 10 },
    );

    // c) Insert a numbered list via slash menu
    await slashMenuInsert(page, 'number');
    await page.keyboard.type('Identify the triggers', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Apply a five-minute breathing break', { delay: 15 });

    // d) Insert a professional note via slash menu
    await slashMenuInsert(page, 'note');
    await page.waitForTimeout(300);
    await page.keyboard.type(
      'This technique is backed by cognitive-behavioural research.',
      { delay: 10 },
    );

    // e) Insert a practical step via slash menu
    await slashMenuInsert(page, 'step');
    await page.waitForTimeout(300);
    // The step node view should have a title field; type into it
    await page.keyboard.type('Regular breathing break', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.type(
      'Take a five-minute break every two hours.',
      { delay: 10 },
    );

    // f) Insert a checklist via slash menu
    await slashMenuInsert(page, 'check');
    await page.waitForTimeout(300);
    await page.keyboard.type('Set a recurring timer', { delay: 15 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Note your stress level before and after', { delay: 15 });

    // Let autosave trigger
    await page.waitForTimeout(6_000);
  });

  // ─── Step 4: Markdown shortcuts ───────────────────────────────────
  test('step 4 — markdown shortcuts @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();
    // Press End to go to the end of content
    await page.keyboard.press('Control+End');

    // ## heading shortcut
    await page.keyboard.press('Enter');
    await page.keyboard.type('## ', { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.type('Quick tips section', { delay: 15 });

    // - bullet shortcut
    await page.keyboard.press('Enter');
    await page.keyboard.type('- ', { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.type('Breathe deeply for one minute', { delay: 15 });

    // > blockquote shortcut
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // exit the list
    await page.keyboard.type('> ', { delay: 30 });
    await page.waitForTimeout(200);
    await page.keyboard.type('Prevention is better than cure.', { delay: 15 });

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 5: Bubble menu (bold + link) ────────────────────────────
  test('step 5 — bubble menu: bold and link @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();

    // Type fresh text to select from. Go to end and type a line.
    await page.keyboard.press('Meta+a'); // Select all
    await page.waitForTimeout(100);
    // Deselect and go to end
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Bold and link test concentration mood end', { delay: 10 });
    await page.waitForTimeout(300);

    // Select "Bold" by programmatic selection
    await page.evaluate(() => {
      const ed = document.querySelector('[role="textbox"][aria-label]');
      if (!ed) return;
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent?.indexOf('Bold') ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 'Bold'.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    // Wait for the bubble menu to appear
    const boldButton = page.getByRole('button', { name: /bold/i });
    await boldButton.waitFor({ timeout: 5_000 });

    // Screenshot: bubble menu
    await page.screenshot({
      path: screenshotPath('author', 'bubble-menu'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Apply bold
    await boldButton.click();
    await page.waitForTimeout(300);

    // Select "concentration" for the link
    await page.evaluate(() => {
      const ed = document.querySelector('[role="textbox"][aria-label]');
      if (!ed) return;
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent?.indexOf('concentration') ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 'concentration'.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    // Click link button in the bubble menu
    const linkButton = page.getByRole('button', { name: /^link$/i });
    await linkButton.waitFor({ timeout: 5_000 });
    await linkButton.click();

    // Link popover should appear
    const linkInput = page.locator('#bubble-link-url');
    await linkInput.waitFor({ timeout: 5_000 });

    // Screenshot: link popover
    await page.screenshot({
      path: screenshotPath('author', 'link-popover'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // a) Enter an allowed host (https)
    await linkInput.fill('https://example.com/stress-guide');
    await page.getByRole('button', { name: /insert link/i }).click();
    await page.waitForTimeout(300);

    // Verify the link was applied
    await expect(editor.locator('a[href="https://example.com/stress-guide"]')).toBeVisible();

    // Now try a disallowed host: select "mood" and try http://
    await page.evaluate(() => {
      const ed = document.querySelector('[role="textbox"][aria-label]');
      if (!ed) return;
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent?.indexOf('mood') ?? -1;
        if (idx >= 0) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + 'mood'.length);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    // Click link button
    await page.getByRole('button', { name: /^link$/i }).waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: /^link$/i }).click();
    const linkInput2 = page.locator('#bubble-link-url');
    await linkInput2.waitFor({ timeout: 5_000 });
    await linkInput2.fill('http://insecure-example.com');
    await page.getByRole('button', { name: /insert link/i }).click();

    // Should show an error — only https is allowed
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 3_000 });
    // The link should NOT be applied
    await expect(editor.locator('a[href="http://insecure-example.com"]')).not.toBeVisible();

    // Dismiss / close the popover
    await page.keyboard.press('Escape');

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 6: Block menu + drag ────────────────────────────────────
  test('step 6 — block menu and drag @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    const editor = page.getByRole('textbox', { name: /content editor/i });

    // Hover the first heading to surface the DragHandle, then click the
    // grip button to open the block menu.
    const firstHeading = editor.locator('h2').first();
    await firstHeading.hover();
    await page.waitForTimeout(600);

    // Click the drag grip to open the block menu
    const gripButton = page.getByRole('button', { name: /drag/i });
    await gripButton.waitFor({ timeout: 5_000 });
    await gripButton.click();

    // Wait for block menu to appear and animation to settle
    const blockMenu = page.locator('[role="menu"]');
    await blockMenu.waitFor({ timeout: 5_000 });
    await page.waitForTimeout(400);

    // Screenshot: block menu
    await page.screenshot({
      path: screenshotPath('author', 'block-menu'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Click "Move up"
    const moveUpItem = blockMenu.getByRole('menuitem', { name: /move up/i });
    await moveUpItem.click();
    await page.waitForTimeout(500);

    // Drag: hover a paragraph to surface the drag handle, then drag it down
    const secondParagraph = editor.locator('p').nth(1);
    await secondParagraph.hover();
    await page.waitForTimeout(600);

    // Re-find the drag grip for the new block
    const gripButton2 = page.getByRole('button', { name: /drag/i });
    await gripButton2.waitFor({ timeout: 3_000 });
    const gripBox = await gripButton2.boundingBox();
    expect(gripBox).toBeTruthy();

    // Drag down by ~80 px (roughly one block height)
    await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      gripBox!.x + gripBox!.width / 2,
      gripBox!.y + gripBox!.height / 2 + 80,
      { steps: 5 },
    );
    await page.mouse.up();

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 7: Insert an image ──────────────────────────────────────
  test('step 7 — insert image via slash menu @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();
    await page.keyboard.press('Control+End');

    // Open slash menu and pick Image
    await editor.press('Enter');
    await editor.pressSequentially('/', { delay: 30 });
    await page.locator('[role="listbox"]').first().waitFor({ timeout: 5_000 });
    await page.keyboard.type('image', { delay: 30 });
    await page.waitForTimeout(200);

    // Screenshot: image option in slash menu
    await page.screenshot({
      path: screenshotPath('author', 'image-upload'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Set up file chooser handler before triggering
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.keyboard.press('Enter');

    // Upload the fixture PNG
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(TEST_IMAGE_PATH);

    // Wait for upload to complete (processing state then ready)
    // The image node should appear in the editor
    await page.waitForTimeout(5_000);

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 8: Insert a CTA ────────────────────────────────────────
  test('step 8 — insert CTA via slash menu @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();
    await page.keyboard.press('Control+End');

    // Insert CTA via slash menu
    await slashMenuInsert(page, 'call');
    await page.waitForTimeout(500);

    // The CTA node view should have a popover or inline configuration
    // Type in the CTA
    await page.keyboard.type('Book a consultation', { delay: 15 });

    // Screenshot: CTA
    await page.screenshot({
      path: screenshotPath('author', 'cta-popover'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 9: Fill properties ──────────────────────────────────────
  test('step 9 — fill properties panel @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Open the Properties accordion
    await page.getByRole('button', { name: /properties/i }).click();
    await page.waitForTimeout(500);

    // Fill summary (identified by its placeholder; Field label is not linked via htmlFor)
    await page.getByRole('textbox', { name: /short summary/i }).fill(
      'Practical tips for reducing stress during the workday and maintaining balance.',
    );

    // Fill outcome (identified by its accessible name from the Input component)
    await page.getByRole('textbox', { name: /expected outcome/i }).fill(
      'You will learn three techniques for recognising and easing everyday stress.',
    );

    // Fill duration (identified by its accessible name)
    await page.getByRole('textbox', { name: /reading time/i }).or(
      page.getByRole('spinbutton', { name: /reading time/i }),
    ).fill('10');

    // Fill proposed audience — the Select trigger is inside a Field
    // Use the trigger button text
    const audienceTrigger = page.locator('#proposedAudience').getByRole('combobox');
    await audienceTrigger.click();
    await page.waitForTimeout(300);
    await page.getByRole('option').first().click();

    // Add a source
    await page.getByRole('button', { name: /add source/i }).click();
    await page.waitForTimeout(300);
    // Source fields use the Field component label text, but may not have htmlFor linkage
    await page.getByRole('textbox', { name: /source label/i }).first().fill('WHO mental health guidelines');
    await page.getByRole('textbox', { name: /source url/i }).first().fill('https://www.who.int/mental_health');

    // Screenshot: properties
    await page.screenshot({
      path: screenshotPath('author', 'properties'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Wait for autosave
    await page.waitForTimeout(6_000);
  });

  // ─── Step 10: Autosave and reload persistence ─────────────────────
  test('step 10 — autosave and reload persistence @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Make a small edit so we can wait for autosave to trigger
    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Persistence check', { delay: 10 });

    // Wait for autosave to show "Saved"
    await waitForSaved(page);

    // Screenshot: autosave status
    await page.screenshot({
      path: screenshotPath('author', 'autosave-saved'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Reload and verify persistence
    await page.reload();
    await waitForEditorReady(page);

    // Check the title persisted
    const titleInput = page.getByRole('textbox', { name: /title/i }).first();
    await expect(titleInput).toHaveValue('E2E editor journey article');

    // Check body content persisted — look for heading text
    const editorBody = page.getByRole('textbox', { name: /content editor/i });
    await expect(editorBody.locator('h2').first()).toContainText(/understanding|quick tips|stress/i);

    // Check "Persistence check" text survived the reload
    await expect(editorBody).toContainText('Persistence check');
  });

  // ─── Step 11: Conflict handling ───────────────────────────────────
  test('step 11 — conflict handling @editor', async ({ page, context }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Open the same editor in a second page (same context = shared session)
    const page2 = await context.newPage();
    await page2.goto(editorUrl);
    await waitForEditorReady(page2);

    // Make a change in page2
    const editor2 = page2.getByRole('textbox', { name: /content editor/i });
    await editor2.click();
    await page2.keyboard.press('Control+End');
    await page2.keyboard.press('Enter');
    await page2.keyboard.type('Edited from second tab', { delay: 15 });
    // Wait for autosave on page2
    await page2.waitForTimeout(7_000);
    await page2.close();

    // Now make an edit on page1 (should cause a conflict on save)
    const editor1 = page.getByRole('textbox', { name: /content editor/i });
    await editor1.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Edited from first tab', { delay: 15 });
    // Wait for autosave to trigger and detect the conflict
    await page.waitForTimeout(7_000);

    // The conflict notice must appear (the Alert, not the status badge)
    const conflictAlert = page.getByRole('alert').filter({ hasText: /changed by someone else/i });
    await conflictAlert.waitFor({ timeout: 15_000 });

    // Screenshot: conflict
    await page.screenshot({
      path: screenshotPath('author', 'conflict'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Resolve: reload server version
    await page.getByRole('button', { name: /reload server version/i }).click();
    await page.waitForTimeout(2_000);

    // The conflict should be resolved
    await expect(conflictAlert).not.toBeVisible({ timeout: 5_000 });

    // Make another edit after resolution
    await editor1.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Content after conflict resolution', { delay: 15 });
    await page.waitForTimeout(6_000);
  });

  // ─── Step 12: Preview widths ──────────────────────────────────────
  test('step 12 — preview at different widths @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Open preview
    await page.getByRole('button', { name: /preview/i }).first().click();
    await page.waitForTimeout(500);

    // Mobile (390)
    const mobileButton = page.getByRole('button', { name: /mobile.*390/i });
    await mobileButton.click();
    await page.waitForTimeout(300);

    let frame = page.locator('[data-testid="preview-frame"]');
    let box = await frame.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(390);

    // Screenshot: phone preview
    await page.screenshot({
      path: screenshotPath('author', 'preview-phone'),
      viewport: { width: 390, height: 844 },
    });

    // Desktop (1440)
    const desktopButton = page.getByRole('button', { name: /desktop.*1440/i });
    await desktopButton.click();
    await page.waitForTimeout(300);

    box = await frame.boundingBox();
    // Desktop preview is constrained by the preview panel width
    // but the inner frame has width: 1440px set
    const frameWidth = await frame.evaluate((el) => el.getBoundingClientRect().width);
    // The width should be set to 1440 but may be constrained by viewport
    // Assert the CSS width is applied
    const cssWidth = await frame.evaluate((el) => el.style.width);
    expect(cssWidth).toBe('1440px');

    // Screenshot: desktop preview
    await page.screenshot({
      path: screenshotPath('author', 'preview-desktop'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Phone/reflow (320)
    const phoneButton = page.getByRole('button', { name: /phone.*320/i });
    await phoneButton.click();
    await page.waitForTimeout(300);

    box = await frame.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBe(320);

    // Close preview
    await page.getByRole('button', { name: /close preview/i }).click();
    await page.waitForTimeout(300);
  });

  // ─── Step 13: Locale tabs (hu, en, sr-Cyrl) ──────────────────────
  test('step 13 — locale tabs and sr-Cyrl preview @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Screenshot: locale tabs
    await page.screenshot({
      path: screenshotPath('author', 'locale-tabs'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Switch to Hungarian tab — variant does not exist yet
    const huTab = page.getByRole('tab', { name: /hungarian/i });
    await huTab.click();

    // Create the Hungarian variant
    const createHuButton = page.getByRole('button', { name: /create.*variant/i });
    await createHuButton.waitFor({ timeout: 15_000 });
    await createHuButton.click();
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 15_000 });

    // Type a title and body in Hungarian
    const huTitle = page.getByRole('textbox', { name: /title/i }).first();
    await huTitle.fill('A munkahelyi stressz kezelese');

    const huEditor = page.getByRole('textbox', { name: /content editor/i });
    await huEditor.click();
    await page.keyboard.type('A munkahelyi stressz csokkentesenek gyakorlati tippjei.', { delay: 10 });

    // Wait for autosave
    await page.waitForTimeout(6_000);

    // Switch to English tab — variant does not exist yet
    const enTab = page.getByRole('tab', { name: /english/i });
    await enTab.click();

    // Create the English variant
    const createEnButton = page.getByRole('button', { name: /create.*variant/i });
    await createEnButton.waitFor({ timeout: 15_000 });
    await createEnButton.click();
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 15_000 });

    // Type a title and body in English
    const enTitle = page.getByRole('textbox', { name: /title/i }).first();
    await enTitle.fill('Managing workplace stress');

    const enEditor = page.getByRole('textbox', { name: /content editor/i });
    await enEditor.click();
    await page.keyboard.type('Practical tips for reducing stress during the workday.', { delay: 10 });

    // Wait for autosave
    await page.waitForTimeout(6_000);

    // Switch to sr-Cyrl tab — should show read-only preview
    const cyrTab = page.getByRole('tab', { name: /cyrillic/i });
    await cyrTab.click();
    await page.waitForTimeout(3_000);

    // The sr-Cyrl tab should show the derived locale notice
    await expect(page.getByText(/automatically derived/i)).toBeVisible({ timeout: 5_000 });
  });

  // ─── Step 14: Submit all three locales ────────────────────────────
  test('step 14 — submit all three locales @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);

    // Submit sr-Latn
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // Audience was set in step 9; submit directly
    const submitButton = page.getByRole('button', { name: /submit for review/i });
    await submitButton.click();
    await page.getByText(/submitted/i).waitFor({ timeout: 10_000 });

    // Screenshot: submitted
    await page.screenshot({
      path: screenshotPath('author', 'submitted'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Submit hu — audience must be set first
    const huUrl = `${ADMIN_URL}/cms/resources/${resourceId}/variants/hu`;
    await page.goto(huUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 15_000 });

    // Open Properties and set audience
    await page.getByRole('button', { name: /properties/i }).click();
    await page.waitForTimeout(300);
    const huAudience = page.locator('#proposedAudience').getByRole('combobox');
    await huAudience.click();
    await page.waitForTimeout(300);
    await page.getByRole('option').first().click();
    await page.waitForTimeout(6_000); // autosave

    await page.getByRole('button', { name: /submit for review/i }).click();
    await page.getByText(/submitted/i).waitFor({ timeout: 10_000 });

    // Submit en — audience must be set first
    const enUrl = `${ADMIN_URL}/cms/resources/${resourceId}/variants/en`;
    await page.goto(enUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 15_000 });

    // Open Properties and set audience
    await page.getByRole('button', { name: /properties/i }).click();
    await page.waitForTimeout(300);
    const enAudience = page.locator('#proposedAudience').getByRole('combobox');
    await enAudience.click();
    await page.waitForTimeout(300);
    await page.getByRole('option').first().click();
    await page.waitForTimeout(6_000); // autosave

    await page.getByRole('button', { name: /submit for review/i }).click();
    await page.getByText(/submitted/i).waitFor({ timeout: 10_000 });
  });

  // ─── Step 15: Reviewer returns one locale with a comment ──────────
  test('step 15 — reviewer returns sr-Latn for changes @editor', async ({ page }) => {
    await signInStaff(page, USERS.reviewer);
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });

    // Click "Return for changes"
    const returnButton = page.getByRole('button', { name: /return for changes/i });
    await returnButton.waitFor({ timeout: 10_000 });
    await returnButton.click();

    // The return dialog should appear
    const returnDialog = page.getByRole('dialog', { name: /return for changes/i });
    await returnDialog.waitFor({ timeout: 5_000 });

    // Type a comment
    const commentField = returnDialog.locator('textarea');
    await commentField.fill('Please add a source citation for the five-minute break recommendation.');

    // Screenshot: return for changes
    await page.screenshot({
      path: screenshotPath('reviewer', 'return-for-changes'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Confirm
    await returnDialog.getByRole('button', { name: /return for changes/i }).click();

    // Wait for the action to complete
    await page.getByText(/returned/i).waitFor({ timeout: 10_000 });
  });

  // ─── Step 16: Author fixes and resubmits ──────────────────────────
  test('step 16 — author fixes and resubmits @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl);
    await waitForEditorReady(page);

    // The revision should now be in "changes_requested" state (badge next to heading)
    await expect(
      page.getByText('Changes requested', { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Make an edit (add a source or change something)
    const editor = page.getByRole('textbox', { name: /content editor/i });
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Source: WHO (2024)', { delay: 15 });

    // Wait for autosave
    await page.waitForTimeout(6_000);

    // Resubmit
    const submitButton = page.getByRole('button', { name: /submit for review/i });
    await submitButton.click();
    await page.getByText(/submitted/i).waitFor({ timeout: 10_000 });
  });

  // ─── Step 17: Reviewer approves all three ─────────────────────────
  test('step 17 — reviewer approves all three locales @editor', async ({ page }) => {
    await signInStaff(page, USERS.reviewer);

    // Approve sr-Latn
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });
    const approveSrLatn = page.getByRole('button', { name: /approve/i });
    await approveSrLatn.waitFor({ timeout: 10_000 });
    await approveSrLatn.click();
    // Wait for the toast "Revision approved" (not the badge "Approved" in tabs)
    await page.getByText('Revision approved').waitFor({ timeout: 10_000 });

    // Screenshot: approve
    await page.screenshot({
      path: screenshotPath('reviewer', 'approve'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Approve hu
    const huUrl = `${ADMIN_URL}/cms/resources/${resourceId}/variants/hu`;
    await page.goto(huUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /approve/i }).click();
    await page.getByText('Revision approved').waitFor({ timeout: 10_000 });

    // Approve en
    const enUrl = `${ADMIN_URL}/cms/resources/${resourceId}/variants/en`;
    await page.goto(enUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /approve/i }).click();
    await page.getByText('Revision approved').waitFor({ timeout: 10_000 });
  });

  // ─── Step 18: Publisher publishes ─────────────────────────────────
  test('step 18 — publisher publishes through dialog @editor', async ({ page }) => {
    await signInStaff(page, USERS.publisher);
    await page.goto(editorUrl);
    await page.getByRole('heading', { name: /edit variant/i }).waitFor({ timeout: 20_000 });

    // Click "Publish now" to open the dialog
    const publishButton = page.getByRole('button', { name: /publish now/i });
    await publishButton.waitFor({ timeout: 10_000 });
    await publishButton.click();

    // The publish dialog should appear
    const publishDialog = page.getByRole('dialog', { name: /publish resource/i });
    await publishDialog.waitFor({ timeout: 5_000 });

    // Screenshot: publish dialog
    await page.screenshot({
      path: screenshotPath('publisher', 'publish-dialog'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });

    // Confirm audience label is shown
    await expect(publishDialog.getByText('Proposed audience')).toBeVisible();

    // Click "Publish now" in the dialog
    await publishDialog.getByRole('button', { name: /publish now/i }).click();

    // Wait for publication to complete
    await page.getByText(/published/i).waitFor({ timeout: 15_000 });

    // Screenshot: published
    await page.screenshot({
      path: screenshotPath('publisher', 'published'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });
  });

  // ─── Step 19: Employee sees the article in workspace ──────────────
  test('step 19 — employee sees the article in workspace @editor', async ({ page }) => {
    await signInEmployee(page, USERS.employeeA);

    // The home page lists published content; the employee sees the English variant
    const articleLink = page.getByRole('link', { name: /managing workplace stress/i });
    await articleLink.waitFor({ timeout: 15_000 });
    await articleLink.click();
    await page.waitForTimeout(2_000);

    // The article detail should show the title
    await expect(page.getByRole('heading', { name: /managing workplace stress/i })).toBeVisible({ timeout: 10_000 });

    // Screenshot: employee sees article
    await page.screenshot({
      path: screenshotPath('employee', 'article-detail'),
      clip: { x: 0, y: 0, width: 1440, height: 900 },
    });
  });
});

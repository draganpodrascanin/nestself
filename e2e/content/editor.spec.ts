/**
 * Editor UI journey: the acceptance gate for the admin CMS editor (T-C1.12).
 *
 * Every test is tagged `@editor` and drives only the UI. The journey never
 * creates or changes data through the API; it reads the stored revision
 * (GET, the signed-in user's session) to prove that each step saved what the
 * screen shows. The screenshots feed the user manual.
 *
 * The article is written in Serbian (Latin), with a shorter Hungarian and
 * English variant, as authors do (all three are required to publish).
 *
 * Run:
 *   TEST_DATABASE_URL=... pnpm e2e:content -g "@editor" --reporter=line
 */
import { test, expect } from '@playwright/test';
import { ADMIN_URL, WORKSPACE_URL, USERS, signInStaff, signInEmployee, switchLanguage } from './helpers';
import {
  TEST_IMAGE_PATH,
  allNodes,
  blockTypes,
  caretToNewBlockAtEnd,
  editorBody,
  findBlock,
  readRevision,
  screenshotPath,
  selectBackwards,
  settle,
  shoot,
  slashInsert,
  slashMenu,
  textOf,
  waitForEditorReady,
  waitForSaved,
} from './editor-helpers';

const TITLE = 'Kako da prepoznate stres na poslu';
const TITLE_CYRL = 'Како да препознате стрес на послу';
const TITLE_HU = 'Hogyan ismerjük fel a munkahelyi stresszt';
const TITLE_EN = 'How to recognise stress at work';
/** A seeded, published resource the CTA and the related card point at. */
const SEEDED_RESOURCE = /Mirniji kraj dana/;

test.describe('@editor Editor journey', () => {
  test.describe.configure({ mode: 'serial' });

  let resourceId: string;
  const editorUrl = (locale: 'sr-Latn' | 'hu' | 'en' | 'sr-Cyrl' = 'sr-Latn') =>
    `${ADMIN_URL}/cms/resources/${resourceId}/variants/${locale}`;

  // ─── 1. Create an article ────────────────────────────────────────
  test('1 author creates an article @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.getByRole('link', { name: 'Content', exact: true }).click();
    await expect(page.getByRole('heading', { name: /resources/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('link', { name: /create resource/i }).click();
    await expect(page.getByRole('heading', { name: /create article/i })).toBeVisible();
    await page.getByRole('combobox', { name: /primary category/i }).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(/article title/i).fill(TITLE);
    await shoot(page, 'author', 'create-resource');
    await page.getByRole('button', { name: /create article/i }).click();

    await waitForEditorReady(page);
    const match = page.url().match(/resources\/([^/]+)\/variants\/sr-Latn/);
    expect(match, 'the editor opens on the new sr-Latn variant').toBeTruthy();
    resourceId = match![1]!;

    const rev = await readRevision(page, resourceId, 'sr-Latn');
    expect(rev.title).toBe(TITLE);
    expect(rev.state).toBe('draft');
  });

  // ─── 2. The empty canvas ─────────────────────────────────────────
  test('2 the editor reopens on its URL with an empty canvas @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);

    // The title is a large inline field; the body shows a placeholder hint.
    await expect(page.getByRole('textbox', { name: /title/i }).first()).toHaveValue(TITLE);
    await expect(editorBody(page).locator('[data-placeholder]').first()).toHaveAttribute(
      'data-placeholder',
      /\S/,
    );
    // No permanent toolbar above the canvas.
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await shoot(page, 'author', 'editor-empty');
  });

  // ─── 3. Blocks from the slash menu ───────────────────────────────
  test('3 author builds the article with the slash menu @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    const editor = editorBody(page);

    // The menu opens on "/", is grouped, filters, and shows an empty state.
    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('/');
    const menu = slashMenu(page);
    await expect(menu).toBeVisible();
    for (const group of ['Text', 'Lists', 'Blocks', 'Media']) {
      await expect(menu.getByRole('group', { name: group })).toBeVisible();
    }
    await shoot(page, 'author', 'slash-menu', { around: [menu, editor], pad: 24 });
    await page.keyboard.type('zzz');
    await expect(menu.getByText('No matching blocks')).toBeVisible();
    // Esc closes the menu and leaves the typed text.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(editor).toContainText('/zzz');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');

    // Arrow keys move the active option.
    await page.keyboard.type('/head');
    await expect(menu.getByRole('option', { selected: true })).toHaveAccessibleName(/heading 2/i);
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('option', { selected: true })).toHaveAccessibleName(/heading 3/i);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await page.keyboard.type('Šta je stres na poslu');

    await slashInsert(page, 'para', /paragraph/i);
    await page.keyboard.type('Stres na poslu često prolazi neprimećeno i utiče na pažnju, raspoloženje i odnose');

    await slashInsert(page, 'number', /numbered list/i);
    await page.keyboard.type('Prepoznajte okidače');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Napravite pauzu od pet minuta');

    await slashInsert(page, 'note', /professional note/i);
    await page.keyboard.type('Ako stres traje nedeljama, razgovarajte sa stručnjakom.');
    await page.getByRole('combobox', { name: 'Note type' }).click();
    await page.getByRole('option', { name: 'Warning' }).click();

    await slashInsert(page, 'step', /practical step/i);
    await page.getByRole('textbox', { name: 'Step title' }).last().fill('Kratka pauza za disanje');
    await editor.locator('[data-type="practicalStep"] [contenteditable="true"]').last().click();
    await page.keyboard.type('Udahnite polako četiri puta pre sledećeg zadatka.');

    await slashInsert(page, 'check', /checklist/i);
    await page.keyboard.type('Podesite podsetnik');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Zabeležite kako se osećate pre i posle');

    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    const heading = findBlock(body, 'sectionHeading', 'Šta je stres na poslu');
    expect(heading?.attrs?.level).toBe(2);
    expect(findBlock(body, 'paragraph', 'Stres na poslu često')).toBeTruthy();
    expect(findBlock(body, 'orderedList')?.content).toHaveLength(2);
    const note = findBlock(body, 'professionalNote', 'razgovarajte sa stručnjakom');
    expect(note?.attrs?.noteKind).toBe('warning');
    const step = findBlock(body, 'practicalStep', 'Udahnite polako');
    expect(step?.attrs?.title).toBe('Kratka pauza za disanje');
    expect(findBlock(body, 'checklist')?.content).toHaveLength(2);
    expect(blockTypes(body)).toEqual(
      expect.arrayContaining([
        'sectionHeading',
        'paragraph',
        'orderedList',
        'professionalNote',
        'practicalStep',
        'checklist',
      ]),
    );
  });

  // ─── 4. Markdown shortcuts ───────────────────────────────────────
  test('4 markdown shortcuts create blocks; italic shortcuts do nothing @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);

    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('### Brzi saveti');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- Prošetajte posle ručka');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // an empty item leaves the list
    await page.keyboard.type('> Mali koraci se računaju.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // leave the quote
    await page.keyboard.type('Ovo *nije kurziv* i ostaje običan tekst');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. Prvi korak');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // leave the list
    await page.keyboard.type('[] Stavka za proveru');

    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    expect(findBlock(body, 'sectionHeading', 'Brzi saveti')?.attrs?.level).toBe(3);
    expect(textOf(findBlock(body, 'bulletList') ?? { type: 'none' })).toContain('Prošetajte posle ručka');
    expect(findBlock(body, 'quote', 'Mali koraci se računaju.')).toBeTruthy();
    expect(findBlock(body, 'paragraph', 'Ovo *nije kurziv* i ostaje')).toBeTruthy();
    expect(allNodes(body).some((n) => n.marks?.some((m) => m.type === 'italic'))).toBe(false);
    expect(
      (body.content ?? []).some((n) => n.type === 'orderedList' && textOf(n).includes('Prvi korak')),
    ).toBe(true);
    expect(
      (body.content ?? []).some((n) => n.type === 'checklist' && textOf(n).includes('Stavka za proveru')),
    ).toBe(true);
  });

  // ─── 5. Bubble menu: bold, link, turn into ───────────────────────
  test('5 bubble menu applies bold and a validated link @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    const editor = editorBody(page);

    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Više o tome pročitajte u vodiču');
    await selectBackwards(page, 'vodiču'.length);
    const bubble = page.getByRole('toolbar', { name: /format/i });
    await expect(bubble).toBeVisible();
    // Bold, Link and Turn into; no italic.
    await expect(bubble.getByRole('button', { name: 'Bold' })).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Link' })).toBeVisible();
    await expect(bubble.getByRole('button', { name: 'Turn into' })).toBeVisible();
    await expect(bubble.getByRole('button', { name: /italic/i })).toHaveCount(0);
    await shoot(page, 'author', 'bubble-menu', { around: [bubble], pad: 160 });

    await bubble.getByRole('button', { name: 'Bold' }).click();
    await expect(editor.locator('strong', { hasText: 'vodiču' })).toBeVisible();

    // Ctrl/Cmd+K opens the link popover for the selection, like the Link button.
    const linkUrl = page.getByRole('textbox', { name: 'Link URL' });
    await page.keyboard.press('ControlOrMeta+k');
    await expect(linkUrl).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(linkUrl).toBeHidden();

    // A link outside the allowlist is refused with a visible message.
    await bubble.getByRole('button', { name: 'Link' }).click();
    await linkUrl.fill('http://insecure.example.com');
    await page.getByRole('button', { name: 'Insert link' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /only https/i })).toBeVisible();
    await shoot(page, 'author', 'link-popover', { around: [page.getByRole('textbox', { name: 'Link URL' }), page.getByRole('alert').filter({ hasText: /only https/i })], pad: 160 });

    await linkUrl.fill('https://example.com/vodic-za-stres');
    await page.getByRole('button', { name: 'Insert link' }).click();
    await expect(editor.locator('a[href="https://example.com/vodic-za-stres"]')).toHaveText('vodiču');

    // Turn the paragraph into a heading from the bubble menu.
    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Kada potražiti pomoć');
    await selectBackwards(page, 'pomoć'.length);
    await bubble.getByRole('button', { name: 'Turn into' }).click();
    await page.getByRole('menuitem', { name: 'Heading 2' }).click();

    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    const para = findBlock(body, 'paragraph', 'Više o tome pročitajte');
    const linked = allNodes(para ?? { type: 'none' }).find((n) => n.text === 'vodiču');
    expect(linked?.marks?.map((m) => m.type).sort()).toEqual(['bold', 'link']);
    expect(linked?.marks?.find((m) => m.type === 'link')?.attrs?.href).toBe(
      'https://example.com/vodic-za-stres',
    );
    expect(findBlock(body, 'sectionHeading', 'Kada potražiti pomoć')?.attrs?.level).toBe(2);
  });

  // ─── 6. Block handle: menu, keyboard, drag ───────────────────────
  test('6 block handle duplicates, deletes and moves blocks @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    const editor = editorBody(page);
    const order = async () =>
      blockTypes((await readRevision(page, resourceId, 'sr-Latn')).body).join(',');

    // Hovering a block shows the "+" and the grip; the grip opens the block menu.
    const quote = editor.locator('blockquote', { hasText: 'Mali koraci' });
    await quote.hover();
    // "+" opens the slash menu on a new block below; Esc closes it.
    await page.getByRole('button', { name: 'Add block' }).click();
    await expect(slashMenu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(slashMenu(page)).toBeHidden();
    await page.keyboard.press('Backspace'); // the typed "/"
    await quote.hover();
    await page.getByRole('button', { name: 'Drag or open menu' }).click();
    const blockMenu = page.getByRole('menu');
    for (const item of ['Turn into', 'Duplicate', 'Delete', 'Move up', 'Move down']) {
      await expect(blockMenu.getByRole('menuitem', { name: item })).toBeVisible();
    }
    await shoot(page, 'author', 'block-menu', { around: [blockMenu, page.getByRole('button', { name: 'Drag or open menu' })], pad: 160 });
    await blockMenu.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(editor.locator('blockquote', { hasText: 'Mali koraci' })).toHaveCount(2);

    // The keyboard reaches the same menu: Ctrl/Cmd+/ on the current block.
    await editor.locator('blockquote', { hasText: 'Mali koraci' }).last().click();
    await page.keyboard.press('ControlOrMeta+/');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete' }).focus();
    await page.keyboard.press('Enter');
    await expect(editor.locator('blockquote', { hasText: 'Mali koraci' })).toHaveCount(1);

    // Alt+Shift+↑ moves the current block up; ↓ moves it back.
    await waitForSaved(page);
    const before = await order();
    await editor.locator('blockquote', { hasText: 'Mali koraci' }).click();
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await waitForSaved(page);
    const movedUp = await order();
    expect(movedUp).not.toBe(before);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await waitForSaved(page);
    expect(await order()).toBe(before);

    // Dragging the grip moves the block below the next one.
    const step = editor.locator('[data-type="practicalStep"]');
    // .first() disambiguates: test 4's [] shortcut added a second checklist.
    const checklist = editor.locator('[data-type="checklist"]').first();
    await step.hover();
    const grip = page.getByRole('button', { name: 'Drag or open menu' });
    const from = (await grip.boundingBox())!;
    const to = (await checklist.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + to.height - 2, { steps: 12 });
    await page.mouse.up();
    await waitForSaved(page);
    const types = blockTypes((await readRevision(page, resourceId, 'sr-Latn')).body);
    expect(types.indexOf('practicalStep')).toBeGreaterThan(types.indexOf('checklist'));
  });

  // ─── 7. Image upload with alt text ───────────────────────────────
  test('7 author uploads an image and writes its alt text @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    const editor = editorBody(page);

    const chooser = page.waitForEvent('filechooser');
    await slashInsert(page, 'image', /image/i);
    await (await chooser).setFiles(TEST_IMAGE_PATH);

    // Upload and processing states are visible until the image is ready.
    const figure = editor.locator('figure[data-type="image"]').last();
    await expect(figure.getByText(/uploading|processing/i)).toBeVisible();
    await expect(figure.locator('img')).toBeVisible({ timeout: 30_000 });
    await figure.getByRole('textbox', { name: 'Alt text' }).fill('Osoba za stolom pravi kratku pauzu');
    await figure.getByRole('textbox', { name: 'Caption' }).fill('Kratka pauza pomaže da se vratite zadatku.');
    await expect(figure.locator('img')).toHaveAttribute('alt', 'Osoba za stolom pravi kratku pauzu');
    await shoot(page, 'author', 'image-upload', { around: [figure] });

    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    const image = findBlock(body, 'image');
    expect(image?.attrs?.mediaAssetId).toMatch(/\S/);
    expect(image?.attrs?.alt).toBe('Osoba za stolom pravi kratku pauzu');
    expect(image?.attrs?.caption).toBe('Kratka pauza pomaže da se vratite zadatku.');
  });

  // ─── 8. Call to action and related resource ──────────────────────
  test('8 author configures a call to action and a related resource @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    const editor = editorBody(page);

    // Inserting a CTA opens its configuration popover.
    await slashInsert(page, 'call', /call to action/i);
    const cta = page.getByRole('dialog', { name: 'Call to action' });
    await expect(cta).toBeVisible();
    await cta.getByRole('combobox', { name: 'Action' }).click();
    await page.getByRole('option', { name: 'Open content' }).click();
    await cta.getByRole('combobox', { name: 'Content' }).fill('Mirniji');
    await page.getByRole('option', { name: SEEDED_RESOURCE }).click();
    await cta.getByRole('textbox', { name: 'Button label' }).fill('Pročitajte i ovo');
    await shoot(page, 'author', 'cta-popover');
    await cta.getByRole('button', { name: 'Done' }).click();
    await expect(cta).toBeHidden();
    await expect(editor.locator('[data-type="cta"]')).toContainText('Pročitajte i ovo');

    // A related resource is picked by searching the CMS, not by typing an id.
    await slashInsert(page, 'related', /related resource/i);
    const related = page.getByRole('dialog', { name: 'Related resource' });
    await related.getByRole('combobox', { name: 'Content' }).fill('Mirniji');
    await page.getByRole('option', { name: SEEDED_RESOURCE }).click();
    await expect(related).toBeHidden();
    await expect(editor.locator('[data-type="relatedResource"]')).toContainText(SEEDED_RESOURCE);

    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    const ctaNode = findBlock(body, 'cta');
    expect(ctaNode?.attrs).toMatchObject({ ctaKind: 'open_content', label: 'Pročitajte i ovo' });
    expect(ctaNode?.attrs?.targetId).toMatch(/\S/);
    expect(findBlock(body, 'relatedResource')?.attrs?.contentResourceId).toBe(ctaNode?.attrs?.targetId);
  });

  // ─── 9. Properties ───────────────────────────────────────────────
  test('9 author fills the properties panel @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);

    await page.getByRole('button', { name: 'Properties' }).click();
    await page.getByRole('textbox', { name: /summary/i }).fill(
      'Kako da na vreme prepoznate znake stresa i šta možete da uradite odmah.',
    );
    await page.getByRole('textbox', { name: /outcome/i }).fill(
      'Znaćete tri jednostavna koraka za smirivanje tokom radnog dana.',
    );
    await page.getByRole('spinbutton', { name: /reading time/i }).fill('6');
    await page.getByRole('combobox', { name: 'Proposed audience' }).click();
    await page.getByRole('option', { name: 'All eligible' }).click();
    await page.getByRole('button', { name: /add source/i }).click();
    await page.getByRole('textbox', { name: /source label/i }).last().fill('Primer izvora (test)');
    await page.getByRole('textbox', { name: /source url/i }).last().fill('https://example.com/izvor');
    await shoot(page, 'author', 'properties');

    await waitForSaved(page);
    const rev = await readRevision(page, resourceId, 'sr-Latn');
    expect(rev.summary).toMatch(/^Kako da na vreme prepoznate/);
    expect(rev.outcome).toMatch(/^Znaćete tri/);
    expect(rev.durationSeconds).toBe(360);
    expect(rev.proposedAudience).toEqual([expect.objectContaining({ kind: 'all_eligible' })]);
    expect(rev.sources).toEqual([{ label: 'Primer izvora (test)', url: 'https://example.com/izvor' }]);
  });

  // ─── 10. Autosave and reload ─────────────────────────────────────
  test('10 everything survives a reload @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Sačuvano automatski');
    await expect(page.getByText(/^saving/i)).toBeVisible();
    await waitForSaved(page);
    await shoot(page, 'author', 'autosave-saved');

    await page.reload();
    await waitForEditorReady(page);
    const editor = editorBody(page);
    await expect(page.getByRole('textbox', { name: /title/i }).first()).toHaveValue(TITLE);
    await expect(editor.locator('h2', { hasText: 'Šta je stres na poslu' })).toBeVisible();
    await expect(editor.locator('ol > li')).toHaveCount(2);
    await expect(editor.getByRole('checkbox')).toHaveCount(2);
    await expect(editor.locator('figure img')).toHaveAttribute('alt', 'Osoba za stolom pravi kratku pauzu');
    await expect(editor.locator('[data-type="cta"]')).toContainText('Pročitajte i ovo');
    await expect(editor.locator('[data-type="relatedResource"]')).toContainText(SEEDED_RESOURCE);
    await expect(editor.locator('a[href="https://example.com/vodic-za-stres"]')).toBeVisible();
    await expect(editor).toContainText('Sačuvano automatski');
  });

  // ─── 11. Conflict ────────────────────────────────────────────────
  test('11 a conflicting save is shown and resolved @editor', async ({ page, context }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);

    const second = await context.newPage();
    await second.goto(editorUrl());
    await waitForEditorReady(second);
    await caretToNewBlockAtEnd(second);
    await second.keyboard.type('Izmena iz druge kartice');
    await waitForSaved(second);
    await second.close();

    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Izmena iz prve kartice');
    const conflict = page.getByRole('alert').filter({ hasText: /changed by someone else/i });
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await shoot(page, 'author', 'conflict', { around: [conflict], pad: 120 });

    await page.getByRole('button', { name: /reload server version/i }).click();
    await expect(conflict).toBeHidden();
    const editor = editorBody(page);
    await expect(editor).toContainText('Izmena iz druge kartice');
    await expect(editor).not.toContainText('Izmena iz prve kartice');

    // Editing continues normally after the reload.
    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Nastavak posle sukoba');
    await waitForSaved(page);
    const { body } = await readRevision(page, resourceId, 'sr-Latn');
    expect(textOf(body)).toContain('Izmena iz druge kartice');
    expect(textOf(body)).toContain('Nastavak posle sukoba');
    expect(textOf(body)).not.toContain('Izmena iz prve kartice');
    // The reloaded reading time is still 6 minutes, not 6 hours.
    const rev = await readRevision(page, resourceId, 'sr-Latn');
    expect(rev.durationSeconds).toBe(360);
  });

  // ─── 12. Preview at real widths ──────────────────────────────────
  test('12 preview renders the employee layout at 390, 1440 and 320 px @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);

    await page.getByRole('button', { name: 'Preview' }).click();
    const frame = page.getByTestId('preview-frame');
    for (const [button, width] of [
      [/mobile.*390/i, 390],
      [/desktop.*1440/i, 1440],
      [/phone.*320/i, 320],
    ] as const) {
      await page.getByRole('button', { name: button }).click();
      await settle(page);
      expect(await frame.evaluate((el) => el.scrollWidth)).toBeGreaterThanOrEqual(width);
      await expect(frame.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
      await expect(frame.getByRole('heading', { level: 2, name: 'Šta je stres na poslu' })).toBeVisible();
      if (width === 390) await frame.screenshot({ path: screenshotPath('author', 'preview-phone') });
      if (width === 1440) await shoot(page, 'author', 'preview-desktop');
    }
    await page.getByRole('button', { name: /close preview/i }).click();
    await expect(frame).toBeHidden();
  });

  // ─── 13. Other languages ─────────────────────────────────────────
  test('13 author writes the Hungarian and English variants @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    await shoot(page, 'author', 'locale-tabs');

    const variants = [
      {
        tab: /hungarian/i,
        locale: 'hu' as const,
        title: TITLE_HU,
        heading: 'Mi a munkahelyi stressz',
        text: 'A stressz gyakran észrevétlen marad, és hat a figyelemre és a hangulatra.',
      },
      {
        tab: /english/i,
        locale: 'en' as const,
        title: TITLE_EN,
        heading: 'What stress at work looks like',
        text: 'Stress at work often goes unnoticed and affects attention, mood and relationships.',
      },
    ];
    for (const v of variants) {
      await page.getByRole('tab', { name: v.tab }).click();
      await page.getByRole('button', { name: /create.*variant/i }).click();
      await waitForEditorReady(page);
      await expect(page).toHaveURL(new RegExp(`/variants/${v.locale}$`));
      await page.getByRole('textbox', { name: /title/i }).first().fill(v.title);
      await slashInsert(page, 'head', /heading 2/i);
      await page.keyboard.type(v.heading);
      await slashInsert(page, 'para', /paragraph/i);
      await page.keyboard.type(v.text);
      await slashInsert(page, 'bullet', /bullet/i);
      await page.keyboard.type(v.locale === 'en' ? 'Notice your triggers' : 'Figyelje meg a kiváltó okokat');
      await page.getByRole('button', { name: 'Properties' }).click();
      await page.getByRole('textbox', { name: /summary/i }).fill(v.text);
      await page.getByRole('combobox', { name: 'Proposed audience' }).click();
      await page.getByRole('option', { name: 'All eligible' }).click();
      await waitForSaved(page);
      const rev = await readRevision(page, resourceId, v.locale);
      expect(rev.title).toBe(v.title);
      expect(findBlock(rev.body, 'sectionHeading', v.heading)).toBeTruthy();
      expect(findBlock(rev.body, 'bulletList')).toBeTruthy();
    }

    // sr-Cyrl is a read-only transliteration of sr-Latn.
    await page.getByRole('tab', { name: /cyrillic/i }).click();
    await expect(page.getByText(/automatically derived/i)).toBeVisible();
    await expect(page.getByText(TITLE_CYRL).first()).toBeVisible();
    await expect(page.getByText('Шта је стрес на послу').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Content editor' })).toHaveCount(0);
  });

  // ─── 14. Submit ──────────────────────────────────────────────────
  test('14 author submits all three locales @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    for (const locale of ['sr-Latn', 'hu', 'en'] as const) {
      await page.goto(editorUrl(locale));
      await waitForEditorReady(page);
      await page.getByRole('button', { name: /submit for review/i }).click();
      await expect(page.getByText('Submitted for review', { exact: true }).first()).toBeVisible();
      if (locale === 'sr-Latn') await shoot(page, 'author', 'submitted');
      expect((await readRevision(page, resourceId, locale)).state).toBe('in_review');
    }
  });

  // ─── 15. Return for changes ──────────────────────────────────────
  test('15 reviewer returns sr-Latn with a comment @editor', async ({ page }) => {
    await signInStaff(page, USERS.reviewer);
    await page.goto(editorUrl());
    await expect(page.getByRole('heading', { name: /edit variant/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Return for changes' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Return for changes' });
    await expect(dialog).toBeVisible();
    // Confirming without a comment keeps the dialog open with an error.
    await dialog.getByRole('button', { name: 'Return for changes' }).click();
    await expect(dialog.getByText('Write what needs to change.').first()).toBeVisible();
    await dialog.getByRole('textbox', { name: /comment/i }).fill(
      'Dodajte izvor za preporuku o pauzi od pet minuta.',
    );
    await expect(dialog.getByText('Write what needs to change.')).toHaveCount(0);
    await shoot(page, 'reviewer', 'return-for-changes');
    await dialog.getByRole('button', { name: 'Return for changes' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Returned for changes', { exact: true }).first()).toBeVisible();
    expect((await readRevision(page, resourceId, 'sr-Latn')).state).toBe('changes_requested');
  });

  // ─── 16. Resubmit ────────────────────────────────────────────────
  test('16 author revises and resubmits @editor', async ({ page }) => {
    await signInStaff(page, USERS.author);
    await page.goto(editorUrl());
    await waitForEditorReady(page);
    await expect(page.getByText('Changes requested', { exact: true }).first()).toBeVisible();

    await caretToNewBlockAtEnd(page);
    await page.keyboard.type('Izvor je naveden u svojstvima članka.');
    await waitForSaved(page);
    await page.getByRole('button', { name: /submit for review/i }).click();
    await expect(page.getByText('Submitted for review', { exact: true }).first()).toBeVisible();
    expect((await readRevision(page, resourceId, 'sr-Latn')).state).toBe('in_review');
  });

  // ─── 17. Approve ─────────────────────────────────────────────────
  test('17 reviewer approves all three locales @editor', async ({ page }) => {
    await signInStaff(page, USERS.reviewer);
    for (const locale of ['sr-Latn', 'hu', 'en'] as const) {
      await page.goto(editorUrl(locale));
      await expect(page.getByRole('heading', { name: /edit variant/i })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByText('Revision approved').first()).toBeVisible();
      if (locale === 'sr-Latn') await shoot(page, 'reviewer', 'approve');
      expect((await readRevision(page, resourceId, locale)).state).toBe('approved');
    }
  });

  // ─── 18. Publish ─────────────────────────────────────────────────
  test('18 publisher publishes through the dialog @editor', async ({ page }) => {
    await signInStaff(page, USERS.publisher);
    await page.goto(editorUrl());
    await expect(page.getByRole('heading', { name: /edit variant/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Publish now' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Publish resource' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Proposed audience')).toBeVisible();
    await expect(dialog.getByText('All eligible', { exact: true })).toBeVisible();
    await shoot(page, 'publisher', 'publish-dialog');
    await dialog.getByRole('button', { name: 'Publish now' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await shoot(page, 'publisher', 'published');
  });

  // ─── 19. The employee reads it ───────────────────────────────────
  test('19 an employee reads the article in English and Serbian @editor', async ({ page }) => {
    await signInEmployee(page, USERS.employeeA);

    await page.getByRole('link', { name: TITLE_EN }).click();
    await expect(page.getByRole('heading', { level: 1, name: TITLE_EN })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'What stress at work looks like' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Notice your triggers' })).toBeVisible();
    await shoot(page, 'employee', 'article-detail');

    await switchLanguage(page, 'Srpski');
    await page.goto(`${WORKSPACE_URL}/`);
    await page.getByRole('link', { name: TITLE }).click();
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Šta je stres na poslu' })).toBeVisible();
    // The author entered 6 minutes of reading time on this variant.
    await expect(page.getByText('6 min', { exact: true })).toBeVisible();
    await expect(page.getByText('Ako stres traje nedeljama, razgovarajte sa stručnjakom.')).toBeVisible();
    await expect(page.getByText('Kratka pauza za disanje')).toBeVisible();
    await expect(page.getByText('Podesite podsetnik')).toBeVisible();
    const image = page.getByRole('img', { name: 'Osoba za stolom pravi kratku pauzu' });
    await expect(image).toBeVisible();
    // The rendition loads (the API checks the asset against the reader's language).
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await expect(page.getByRole('link', { name: 'Pročitajte i ovo' })).toBeVisible();
    await expect(page.getByRole('link', { name: SEEDED_RESOURCE })).toBeVisible();
    await expect(page.getByRole('link', { name: 'vodiču' })).toHaveAttribute(
      'href',
      'https://example.com/vodic-za-stres',
    );
    await shoot(page, 'employee', 'article-detail-sr', { fullPage: true });
  });
});

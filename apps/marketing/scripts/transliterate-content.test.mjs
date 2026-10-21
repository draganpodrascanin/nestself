import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import to load after the transliterate-core dependency is resolved
const { transliterateMdxBody, transliterateJsonContent, transliterateFile } = await import(
  join(__dirname, 'transliterate-content.mjs')
);

const { transliterate } = await import(
  join(__dirname, '..', '..', '..', 'packages', 'i18n', 'scripts', 'transliterate-core.mjs')
);

describe('transliterateMdxBody', () => {
  it('preserves inline code spans untouched', () => {
    const input = 'Koristite `getEntry` za pristup sadržaju.';
    const result = transliterateMdxBody(input);
    // The code span should survive unchanged
    expect(result).toContain('`getEntry`');
    // The surrounding text should be transliterated
    expect(result).toContain(transliterate('Koristite'));
  });

  it('preserves URLs in link destinations', () => {
    const input = 'Posetite [NestSelf](https://nestself.com/sr) za više informacija.';
    const result = transliterateMdxBody(input);
    // URL should remain unchanged
    expect(result).toContain('](https://nestself.com/sr)');
  });

  it('preserves fenced code blocks', () => {
    const input = 'Primer:\n\n```ts\nconst x = "hello";\n```\n\nKraj.';
    const result = transliterateMdxBody(input);
    expect(result).toContain('```ts\nconst x = "hello";\n```');
    expect(result).toContain(transliterate('Kraj'));
  });

  it('preserves JSX/HTML tags and attributes', () => {
    const input = '<Callout kind="tip">Ovo je savet.</Callout>';
    const result = transliterateMdxBody(input);
    expect(result).toContain('<Callout kind="tip">');
    expect(result).toContain('</Callout>');
  });

  it('preserves import/export lines', () => {
    const input = 'import { Callout } from "./Callout"\n\nTekst za transliteraciju.';
    const result = transliterateMdxBody(input);
    expect(result).toContain('import { Callout } from "./Callout"');
  });
});

describe('transliterateJsonContent', () => {
  it('transliterates title but not cover', () => {
    const input = {
      title: 'Razumevanje dobrobiti',
      cover: 'hero-workplace',
      topic: 'psychological',
    };
    const result = transliterateJsonContent(input);
    expect(result.title).toBe(transliterate('Razumevanje dobrobiti'));
    expect(result.cover).toBe('hero-workplace');
    expect(result.topic).toBe('psychological');
  });

  it('does not transliterate URL strings', () => {
    const input = {
      text: 'Posetite nas',
      source: 'https://example.com/resource',
    };
    const result = transliterateJsonContent(input);
    expect(result.text).toBe(transliterate('Posetite nas'));
    // 'source' is in the untouched keys, so it stays as-is
    expect(result.source).toBe('https://example.com/resource');
  });

  it('handles nested objects', () => {
    const input = {
      title: 'Test',
      crisis: {
        title: 'Hitna pomoć',
        body: 'Pozovite',
        lines: [{ label: 'Hitna', value: '112' }],
      },
    };
    const result = transliterateJsonContent(input);
    expect(result.crisis.title).toBe(transliterate('Hitna pomoć'));
    expect(result.crisis.lines[0].label).toBe(transliterate('Hitna'));
  });

  it('preserves arrays of strings with URL detection', () => {
    const input = ['Tekst', 'https://example.com'];
    const result = transliterateJsonContent(input);
    expect(result[0]).toBe(transliterate('Tekst'));
    expect(result[1]).toBe('https://example.com');
  });
});

describe('--check detects a stale Cyrillic file', () => {
  it('detects a stale sr-Cyrl.mdx when it does not match fresh transliteration', async () => {
    // Create a temp directory with an sr-Latn.mdx
    const tmpDir = await mkdtemp(join(tmpdir(), 'transliterate-test-'));
    const slugDir = join(tmpDir, 'articles', 'stale-test');
    await mkdir(slugDir, { recursive: true });

    const latinContent = [
      '---',
      'title: "Razumevanje dobrobiti na radnom mestu"',
      'description: "Vodič za poboljšanje mentalnog zdravlja"',
      'topic: psychological',
      'publishedAt: "2026-09-15"',
      'cover: hero-workplace',
      'coverAlt: "Kolege sarađuju u svetloj kancelariji"',
      '---',
      '',
      'Dobrobit na radnom mestu je važna za zaposlene.',
    ].join('\n');

    const latinPath = join(slugDir, 'sr-Latn.mdx');
    const cyrillicPath = join(slugDir, 'sr-Cyrl.mdx');

    await writeFile(latinPath, latinContent, 'utf-8');

    // Write a STALE Cyrillic file that does not match the transliteration
    await writeFile(cyrillicPath, 'stale content that is outdated\n', 'utf-8');

    // Use transliterateFile to get the expected fresh output
    const { output: freshOutput } = await transliterateFile(latinPath);
    const staleContent = await readFile(cyrillicPath, 'utf-8');

    // The stale content should NOT match the fresh transliteration
    expect(staleContent).not.toBe(freshOutput);

    // Verify the fresh output is an actual transliteration (contains Cyrillic)
    expect(freshOutput).toMatch(/[Ѐ-ӿ]/);

    // Clean up
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('matches when sr-Cyrl.json is a fresh transliteration', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'transliterate-test-'));
    const slugDir = join(tmpDir, 'assessments', 'fresh-test');
    await mkdir(slugDir, { recursive: true });

    const latinJson = JSON.stringify({
      title: 'Razumevanje dobrobiti',
      cover: 'hero-workplace',
      topic: 'psychological',
    }, null, 2) + '\n';

    const latinPath = join(slugDir, 'sr-Latn.json');
    await writeFile(latinPath, latinJson, 'utf-8');

    // Get the fresh transliteration and write it
    const { cyrillicPath, output: freshOutput } = await transliterateFile(latinPath);
    await writeFile(cyrillicPath, freshOutput, 'utf-8');

    // Read it back -- should match exactly
    const written = await readFile(cyrillicPath, 'utf-8');
    expect(written).toBe(freshOutput);

    // Clean up
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe('--check CLI end-to-end', () => {
  const scriptPath = join(__dirname, 'transliterate-content.mjs');

  it('exits 1 and prints STALE when a Cyrillic file is out of date', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'check-e2e-'));
    const slugDir = join(tmpDir, 'articles', 'stale-test');
    await mkdir(slugDir, { recursive: true });

    await writeFile(
      join(slugDir, 'sr-Latn.mdx'),
      '---\ntitle: "Razumevanje dobrobiti"\ndescription: "Opis"\ntopic: psychological\npublishedAt: "2026-09-15"\ncover: hero-workplace\ncoverAlt: "Alt tekst"\n---\n\nTekst za transliteraciju.\n',
      'utf-8',
    );
    await writeFile(join(slugDir, 'sr-Cyrl.mdx'), 'stale content\n', 'utf-8');

    try {
      await execFileAsync('node', [scriptPath, '--check'], {
        env: { ...process.env, __TRANSLITERATE_CONTENT_ROOT: tmpDir },
      });
      // Should not reach here
      expect.fail('Expected --check to exit with code 1');
    } catch (err) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain('STALE');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('exits 0 when all Cyrillic files are fresh', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'check-e2e-'));
    const slugDir = join(tmpDir, 'articles', 'fresh-test');
    await mkdir(slugDir, { recursive: true });

    const latinContent =
      '---\ntitle: "Razumevanje dobrobiti"\ndescription: "Opis"\ntopic: psychological\npublishedAt: "2026-09-15"\ncover: hero-workplace\ncoverAlt: "Alt tekst"\n---\n\nTekst za transliteraciju.\n';

    await writeFile(join(slugDir, 'sr-Latn.mdx'), latinContent, 'utf-8');

    // Generate the correct Cyrillic file first
    const { output: freshOutput } = await transliterateFile(
      join(slugDir, 'sr-Latn.mdx'),
    );
    await writeFile(join(slugDir, 'sr-Cyrl.mdx'), freshOutput, 'utf-8');

    // --check should succeed
    const { stdout } = await execFileAsync('node', [scriptPath, '--check'], {
      env: { ...process.env, __TRANSLITERATE_CONTENT_ROOT: tmpDir },
    });
    // No error thrown means exit code 0
    expect(stdout).not.toContain('STALE');

    await rm(tmpDir, { recursive: true, force: true });
  });
});

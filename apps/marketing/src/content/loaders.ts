import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { cache } from 'react';
import matter from 'gray-matter';
import type { z } from 'zod';
import type { Locale } from '@nestself/i18n';
import type { ContentType, ContentEntry, LocalisedData } from './types';
import type { FrontmatterOf, Assessment, ArticleFrontmatter, WebinarFrontmatter, ToolFrontmatter } from './schemas';
import { frontmatterSchemas, AssessmentSchema } from './schemas';
import { readingMinutes } from './reading-time';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTENT_ROOT: string = join(process.cwd(), 'content');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface LoaderOptions {
  root?: string;
  includeDrafts?: boolean;
}

function contentRoot(opts?: LoaderOptions): string {
  return opts?.root ?? CONTENT_ROOT;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Locale resolution order.
 * sr-Cyrl tries sr-Cyrl -> sr-Latn -> en.
 * All others try the requested locale then en.
 */
function localeChain(locale: Locale): Locale[] {
  if (locale === 'sr-Cyrl') return ['sr-Cyrl', 'sr-Latn', 'en'];
  if (locale === 'en') return ['en'];
  return [locale, 'en'];
}

async function resolveFile(
  dir: string,
  locale: Locale,
  ext: string,
): Promise<{ path: string; resolvedLocale: Locale; fallback: boolean } | null> {
  const chain = localeChain(locale);
  for (const candidate of chain) {
    const filePath = join(dir, `${candidate}${ext}`);
    if (await exists(filePath)) {
      return {
        path: filePath,
        resolvedLocale: candidate,
        fallback: candidate !== locale,
      };
    }
  }
  return null;
}

function handleStrict(fallback: boolean, locale: Locale, filePath: string): void {
  if (fallback && process.env.CONTENT_STRICT === '1') {
    throw new Error(
      `Content strict mode: no ${locale} file found, fell back at ${filePath}`,
    );
  }
}

function formatZodIssues(issues: z.core.$ZodIssue[]): string {
  return issues
    .map((iss) => `${iss.path?.join('.') ?? '(root)'}: ${iss.message}`)
    .join('; ');
}

// ---------------------------------------------------------------------------
// Typed sort comparators per content type
// ---------------------------------------------------------------------------

type AnyFrontmatter = ArticleFrontmatter | WebinarFrontmatter | ToolFrontmatter;

/**
 * Sort entries in-place according to content type:
 * - articles: by publishedAt descending
 * - webinars: by startsAt ascending
 * - tools: by order ascending, then title ascending
 */
function sortEntries<T extends ContentType>(
  type: T,
  entries: ContentEntry<FrontmatterOf<T>>[],
): void {
  // Widen to the union so we can narrow per-type with `in` checks.
  const list = entries as ContentEntry<AnyFrontmatter>[];

  switch (type) {
    case 'articles':
      list.sort((a, b) => {
        const aDate = 'publishedAt' in a.frontmatter ? a.frontmatter.publishedAt : '';
        const bDate = 'publishedAt' in b.frontmatter ? b.frontmatter.publishedAt : '';
        return bDate.localeCompare(aDate);
      });
      break;
    case 'webinars':
      list.sort((a, b) => {
        const aDate = 'startsAt' in a.frontmatter ? a.frontmatter.startsAt : '';
        const bDate = 'startsAt' in b.frontmatter ? b.frontmatter.startsAt : '';
        return aDate.localeCompare(bDate);
      });
      break;
    case 'tools':
      list.sort((a, b) => {
        const aOrder = 'order' in a.frontmatter ? a.frontmatter.order : 100;
        const bOrder = 'order' in b.frontmatter ? b.frontmatter.order : 100;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.frontmatter.title.localeCompare(b.frontmatter.title);
      });
      break;
  }
}

// ---------------------------------------------------------------------------
// MDX entry loaders (articles, webinars, tools)
// ---------------------------------------------------------------------------

async function getEntryRaw<T extends ContentType>(
  type: T,
  slug: string,
  locale: Locale,
  opts?: LoaderOptions,
): Promise<ContentEntry<FrontmatterOf<T>> | null> {
  const dir = join(contentRoot(opts), type, slug);
  if (!(await exists(dir))) return null;

  const resolved = await resolveFile(dir, locale, '.mdx');
  if (!resolved) return null;

  handleStrict(resolved.fallback, locale, resolved.path);

  const raw = await readFile(resolved.path, 'utf-8');
  const { data, content } = matter(raw);

  const schema = frontmatterSchemas[type];
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Invalid content: ${resolved.path}: ${formatZodIssues(result.error.issues)}`,
    );
  }

  return {
    type,
    slug,
    locale: resolved.resolvedLocale,
    requestedLocale: locale,
    fallback: resolved.fallback,
    frontmatter: result.data as FrontmatterOf<T>,
    body: content.trim(),
    readingMinutes: readingMinutes(content),
  };
}

async function listEntriesRaw<T extends ContentType>(
  type: T,
  locale: Locale,
  opts?: LoaderOptions,
): Promise<ContentEntry<FrontmatterOf<T>>[]> {
  const typeDir = join(contentRoot(opts), type);
  if (!(await exists(typeDir))) return [];

  const dirs = await readdir(typeDir, { withFileTypes: true });
  const slugDirs = dirs.filter((d) => d.isDirectory());

  const entries: ContentEntry<FrontmatterOf<T>>[] = [];
  for (const dir of slugDirs) {
    const entry = await getEntryRaw(type, dir.name, locale, opts);
    if (!entry) continue;
    if (!opts?.includeDrafts && (entry.frontmatter as Record<string, unknown>).draft) {
      continue;
    }
    entries.push(entry);
  }

  sortEntries(type, entries);

  return entries;
}

async function listSlugsRaw(
  type: ContentType,
  opts?: LoaderOptions,
): Promise<string[]> {
  const typeDir = join(contentRoot(opts), type);
  if (!(await exists(typeDir))) return [];

  const dirs = await readdir(typeDir, { withFileTypes: true });
  const slugs: string[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const enFile = join(typeDir, dir.name, 'en.mdx');
    if (await exists(enFile)) {
      slugs.push(dir.name);
    }
  }
  return slugs.sort();
}

// ---------------------------------------------------------------------------
// Assessment loaders
// ---------------------------------------------------------------------------

async function getAssessmentRaw(
  slug: string,
  locale: Locale,
  opts?: LoaderOptions,
): Promise<(LocalisedData<Assessment> & { slug: string }) | null> {
  const dir = join(contentRoot(opts), 'assessments', slug);
  if (!(await exists(dir))) return null;

  const resolved = await resolveFile(dir, locale, '.json');
  if (!resolved) return null;

  handleStrict(resolved.fallback, locale, resolved.path);

  const raw = await readFile(resolved.path, 'utf-8');
  const parsed = JSON.parse(raw);
  const result = AssessmentSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid content: ${resolved.path}: ${formatZodIssues(result.error.issues)}`,
    );
  }

  return {
    slug,
    data: result.data,
    locale: resolved.resolvedLocale,
    fallback: resolved.fallback,
  };
}

async function listAssessmentSlugsRaw(
  opts?: LoaderOptions,
): Promise<string[]> {
  const assessDir = join(contentRoot(opts), 'assessments');
  if (!(await exists(assessDir))) return [];

  const dirs = await readdir(assessDir, { withFileTypes: true });
  const slugs: string[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const enFile = join(assessDir, dir.name, 'en.json');
    if (await exists(enFile)) {
      slugs.push(dir.name);
    }
  }
  return slugs.sort();
}

async function listAssessmentsRaw(
  locale: Locale,
  opts?: LoaderOptions,
): Promise<Array<LocalisedData<Assessment> & { slug: string }>> {
  const slugs = await listAssessmentSlugsRaw(opts);
  const results: Array<LocalisedData<Assessment> & { slug: string }> = [];
  for (const slug of slugs) {
    const assessment = await getAssessmentRaw(slug, locale, opts);
    if (assessment) results.push(assessment);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Page content loader
// ---------------------------------------------------------------------------

async function loadPageContentRaw<S extends z.ZodTypeAny>(
  page: string,
  locale: Locale,
  schema: S,
  opts?: LoaderOptions,
): Promise<LocalisedData<z.infer<S>>> {
  const dir = join(contentRoot(opts), 'pages', page);
  const resolved = await resolveFile(dir, locale, '.json');

  if (!resolved) {
    throw new Error(`No content found for page "${page}" in any locale`);
  }

  handleStrict(resolved.fallback, locale, resolved.path);

  const raw = await readFile(resolved.path, 'utf-8');
  const parsed = JSON.parse(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid content: ${resolved.path}: ${formatZodIssues(result.error.issues)}`,
    );
  }

  return {
    data: result.data,
    locale: resolved.resolvedLocale,
    fallback: resolved.fallback,
  };
}

// ---------------------------------------------------------------------------
// Cached public API (React cache for per-request memoisation)
// ---------------------------------------------------------------------------

export const getEntry = cache(getEntryRaw) as typeof getEntryRaw;
export const listEntries = cache(listEntriesRaw) as typeof listEntriesRaw;
export const listSlugs = cache(listSlugsRaw) as typeof listSlugsRaw;
export const getAssessment = cache(getAssessmentRaw) as typeof getAssessmentRaw;
export const listAssessmentSlugs = cache(listAssessmentSlugsRaw) as typeof listAssessmentSlugsRaw;
export const listAssessments = cache(listAssessmentsRaw) as typeof listAssessmentsRaw;
export const loadPageContent = cache(loadPageContentRaw) as typeof loadPageContentRaw;

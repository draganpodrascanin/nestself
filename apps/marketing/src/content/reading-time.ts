const WORDS_PER_MINUTE = 200;

/**
 * Estimate reading time in minutes from a body of text.
 * Strips MDX/Markdown syntax before counting words.
 * Returns at least 1 minute.
 */
export function readingMinutes(body: string): number {
  // Strip code blocks, inline code, HTML/JSX tags, import/export lines
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^(import|export)\s.*/gm, '');

  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  return Math.max(1, Math.round(words.length / WORDS_PER_MINUTE));
}

/**
 * Pattern for a "starts with" search term. LIKE treats `%`, `_` and the escape
 * character `\` (PostgreSQL's default) as special, so each is escaped and the
 * term matches itself: a search for `50%` finds names that start with "50%",
 * not every name that starts with "50".
 */
export function likePrefix(term: string): string {
  return `${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

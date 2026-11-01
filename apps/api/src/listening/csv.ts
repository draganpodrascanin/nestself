/**
 * CSV helpers for the aggregate export (spec REP-04). A value that a
 * spreadsheet would read as a formula (`=`, `+`, `-`, `@`, a tab or a carriage
 * return first) is prefixed with an apostrophe; every cell is quoted when it
 * holds a quote, a comma or a line break.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function csvLine(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(csvCell).join(',');
}

/** Rows joined with CRLF and a trailing line break, as most spreadsheet imports expect. */
export function csvDocument(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return [csvLine(header), ...rows.map(csvLine)].join('\r\n') + '\r\n';
}

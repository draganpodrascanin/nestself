/**
 * Client-side parsing of the invitation import textarea: one
 * `email,templateKey[,orgUnitId]` per line (decision "CSV import is a
 * paste-into-textarea"). The operations workspace has no org-unit list, so
 * the org unit is passed as an id and checked by the server, which reports a
 * wrong one per row. Blank lines and a leading `email,...` header line are
 * ignored.
 */
import { InvitationCreateRequestSchema } from '@nestself/contracts';
import type { InvitationImportRequest } from '@nestself/contracts';
import { isInvitableTemplate } from './people-labels';

/** The server accepts at most this many rows in one import. */
export const IMPORT_MAX_ROWS = 500;

export type ImportRow = InvitationImportRequest['invitations'][number];

export type ImportProblemKind = 'columns' | 'email' | 'template' | 'tooMany';

export interface ImportProblem {
  /** 1-based line number in the textarea; 0 for the whole batch. */
  line: number;
  kind: ImportProblemKind;
  value: string;
}

export interface ParsedImport {
  rows: ImportRow[];
  problems: ImportProblem[];
}

const emailSchema = InvitationCreateRequestSchema.shape.email;

export function parseImport(text: string): ParsedImport {
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const cells = trimmed.split(',').map((c) => c.trim());
    if (rows.length === 0 && problems.length === 0 && cells[0]?.toLowerCase() === 'email') return;

    if (cells.length < 2 || cells.length > 3 || !cells[0] || !cells[1]) {
      problems.push({ line, kind: 'columns', value: trimmed });
      return;
    }
    const [emailCell, templateKey, orgUnitId] = cells as [string, string, string | undefined];

    const email = emailSchema.safeParse(emailCell);
    if (!email.success) {
      problems.push({ line, kind: 'email', value: emailCell });
      return;
    }
    if (!isInvitableTemplate(templateKey)) {
      problems.push({ line, kind: 'template', value: templateKey });
      return;
    }
    rows.push({ email: email.data, templateKey, ...(orgUnitId ? { orgUnitId } : {}) });
  });

  if (rows.length > IMPORT_MAX_ROWS) {
    problems.push({ line: 0, kind: 'tooMany', value: String(rows.length) });
  }
  return { rows, problems };
}

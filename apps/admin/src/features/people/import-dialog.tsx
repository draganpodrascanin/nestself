import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Table,
  Td,
  Text,
  Textarea,
  Th,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { InvitationImportResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { IMPORT_MAX_ROWS, parseImport } from './import-parse';
import type { ImportProblem } from './import-parse';
import { importReasonKey, peopleErrorKey } from './people-errors';
import { useImportInvitations } from './use-ops-people';

const IDS = { rows: 'import-rows', form: 'import-form' } as const;

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
  orgId: string;
}

/**
 * Bulk invitation through the operations route (`people.import`): one
 * `email,templateKey[,orgUnitId]` per line, parsed in the browser into the
 * import body. Bad lines are listed before anything is sent; the server's
 * created / skipped / errors answer is shown as a table.
 */
export function ImportDialog({ open, onOpenChange, opsApi, orgId }: ImportDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const importInvitations = useImportInvitations(opsApi, orgId);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [result, setResult] = useState<InvitationImportResponse | null>(null);
  const parsed = useMemo(() => parseImport(text), [text]);

  const close = () => {
    if (!importInvitations.isPending) onOpenChange(false);
  };

  const problemText = (p: ImportProblem) =>
    p.kind === 'tooMany'
      ? t('admin:people.import.problems.tooMany', { max: IMPORT_MAX_ROWS, rows: p.value })
      : t(`admin:people.import.problems.${p.kind}`, { line: p.line, value: p.value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (importInvitations.isPending) return;
    if (parsed.rows.length === 0 || parsed.problems.length > 0) {
      setErrors([
        {
          id: IDS.rows,
          label: t('admin:people.import.rows'),
          message:
            parsed.problems.length > 0 ? t('admin:people.import.fixProblems') : t('admin:people.import.noRows'),
        },
      ]);
      return;
    }
    setErrors([]);
    try {
      const response = await importInvitations.mutateAsync({ invitations: parsed.rows });
      setResult(response);
      addToast({ title: t('admin:people.import.success', { count: response.created }), tone: 'success' });
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) {
        onOpenChange(false);
        return;
      }
      setErrors([{ id: IDS.form, label: t('admin:people.import.title'), message: t(`admin:people.errors.${key}`) }]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={t('admin:people.import.title')}
        description={t('admin:people.import.description')}
        closeLabel={t('common:nav.close')}
      >
        {result ? (
          <div className="space-y-5">
            <Alert tone={result.errors.length > 0 ? 'warning' : 'success'} title={t('admin:people.import.resultTitle')}>
              {t('admin:people.import.resultSummary', {
                created: result.created,
                skipped: result.skipped,
                failed: result.errors.length,
              })}
            </Alert>
            {result.errors.length > 0 ? (
              <Table caption={t('admin:people.import.errorsCaption')} density="compact">
                <thead>
                  <tr>
                    <Th>{t('admin:people.columns.email')}</Th>
                    <Th>{t('admin:people.import.reason')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={`${e.email}-${i}`}>
                      <Td>{e.email}</Td>
                      <Td>{t(`admin:people.import.reasons.${importReasonKey(e.reason)}`)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            <DialogActions>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('admin:people.import.done')}
              </Button>
            </DialogActions>
          </div>
        ) : (
          <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
            <Field
              id={IDS.rows}
              label={t('admin:people.import.rows')}
              description={t('admin:people.import.rowsHint')}
              error={errors.find((e) => e.id === IDS.rows)?.message}
              required
            >
              <Textarea name="rows" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>

            <p role="status" className="type-body text-text-secondary">
              {t('admin:people.import.preview', { count: parsed.rows.length })}
            </p>
            {parsed.problems.length > 0 ? (
              <ul className="space-y-1" aria-label={t('admin:people.import.problemsLabel')}>
                {parsed.problems.map((p) => (
                  <li key={`${p.line}-${p.kind}`}>
                    <Text tone="danger" typeRole="metadata">
                      {problemText(p)}
                    </Text>
                  </li>
                ))}
              </ul>
            ) : null}

            <DialogActions>
              <Button type="button" variant="secondary" onClick={close} disabled={importInvitations.isPending}>
                {t('admin:people.cancel')}
              </Button>
              <Button type="submit" loading={importInvitations.isPending}>
                {t('admin:people.import.submit')}
              </Button>
            </DialogActions>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

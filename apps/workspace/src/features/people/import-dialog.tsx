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
import type { InvitationImportResponse, OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { IMPORT_MAX_ROWS, parseImport } from './import-parse';
import { importReasonKey, peopleErrorKey } from './people-errors';
import { useImportInvitations } from './use-people';

const IDS = { rows: 'import-rows', form: 'import-form' } as const;

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminApi: OrgAdminApi;
  orgId: string;
  orgUnits: readonly OrgUnitResponse[];
}

/**
 * Bulk invitation: one `email,templateKey[,orgUnit]` per line, parsed in the
 * browser into the import body. Bad lines are listed before anything is
 * sent; the server's created / skipped / errors answer is shown as a table.
 */
export function ImportDialog({ open, onOpenChange, adminApi, orgId, orgUnits }: ImportDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const importInvitations = useImportInvitations(adminApi, orgId);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [result, setResult] = useState<InvitationImportResponse | null>(null);
  const parsed = useMemo(() => parseImport(text, orgUnits), [text, orgUnits]);

  const close = () => {
    if (!importInvitations.isPending) onOpenChange(false);
  };

  const problemText = (p: (typeof parsed.problems)[number]) =>
    p.kind === 'tooMany'
      ? t('workspace:people.import.problems.tooMany', { max: IMPORT_MAX_ROWS, rows: p.value })
      : t(`workspace:people.import.problems.${p.kind}`, { line: p.line, value: p.value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (importInvitations.isPending) return;
    if (parsed.rows.length === 0 || parsed.problems.length > 0) {
      setErrors([
        {
          id: IDS.rows,
          label: t('workspace:people.import.rows'),
          message:
            parsed.problems.length > 0
              ? t('workspace:people.import.fixProblems')
              : t('workspace:people.import.noRows'),
        },
      ]);
      return;
    }
    setErrors([]);
    try {
      const response = await importInvitations.mutateAsync({ invitations: parsed.rows });
      setResult(response);
      addToast({ title: t('workspace:people.import.success', { count: response.created }), tone: 'success' });
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) {
        onOpenChange(false);
        return;
      }
      setErrors([{ id: IDS.form, label: t('workspace:people.import.title'), message: t(`workspace:people.errors.${key}`) }]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={t('workspace:people.import.title')}
        description={t('workspace:people.import.description')}
        closeLabel={t('common:nav.close')}
      >
        {result ? (
          <div className="space-y-5">
            <Alert tone={result.errors.length > 0 ? 'warning' : 'success'} title={t('workspace:people.import.resultTitle')}>
              {t('workspace:people.import.resultSummary', {
                created: result.created,
                skipped: result.skipped,
                failed: result.errors.length,
              })}
            </Alert>
            {result.errors.length > 0 ? (
              <Table caption={t('workspace:people.import.errorsCaption')} density="compact">
                <thead>
                  <tr>
                    <Th>{t('workspace:people.columns.email')}</Th>
                    <Th>{t('workspace:people.import.reason')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={`${e.email}-${i}`}>
                      <Td>{e.email}</Td>
                      <Td>{t(`workspace:people.import.reasons.${importReasonKey(e.reason)}`)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            <DialogActions>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('workspace:people.import.done')}
              </Button>
            </DialogActions>
          </div>
        ) : (
          <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
            <Field
              id={IDS.rows}
              label={t('workspace:people.import.rows')}
              description={t('workspace:people.import.rowsHint')}
              error={errors.find((e) => e.id === IDS.rows)?.message}
              required
            >
              <Textarea name="rows" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>

            <p role="status" className="type-body text-text-secondary">
              {t('workspace:people.import.preview', { count: parsed.rows.length })}
            </p>
            {parsed.problems.length > 0 ? (
              <ul className="space-y-1" aria-label={t('workspace:people.import.problemsLabel')}>
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
                {t('workspace:people.cancel')}
              </Button>
              <Button type="submit" loading={importInvitations.isPending}>
                {t('workspace:people.import.submit')}
              </Button>
            </DialogActions>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

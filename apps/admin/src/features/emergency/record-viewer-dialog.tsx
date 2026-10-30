import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, DialogContent, Field, FormErrorSummary, Heading, Input, Select, Text } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { ConversationResponseSchema, EMERGENCY_RECORD_TYPES, IntakeResponseSchema } from '@nestself/contracts';
import type {
  ConversationResponse,
  EmergencyAccessResponse,
  EmergencyRecordResponse,
  EmergencyRecordType,
  IntakeResponse,
} from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { emergencyErrorKey } from './emergency-errors';
import type { EmergencyErrorKey } from './emergency-errors';
import { useReadEmergencyRecord } from './use-emergency';

const IDS = {
  recordType: 'emergency-record-type',
  recordId: 'emergency-record-id',
  form: 'emergency-record-form',
} as const;

export interface RecordViewerDialogProps {
  /** The caller's own active access record; `null` keeps the dialog closed. */
  access: EmergencyAccessResponse | null;
  onClose: () => void;
  opsApi: OpsAdminApi;
}

type RecordView =
  | { kind: 'conversation'; record: ConversationResponse }
  | { kind: 'intake'; record: IntakeResponse }
  | { kind: 'invalid' };

/** `content` is typed `unknown` by the contract; it is shown only when it has the professional route's shape. */
function toView(response: EmergencyRecordResponse): RecordView {
  if (response.recordType === 'conversation') {
    const parsed = ConversationResponseSchema.safeParse(response.content);
    return parsed.success ? { kind: 'conversation', record: parsed.data } : { kind: 'invalid' };
  }
  const parsed = IntakeResponseSchema.safeParse(response.content);
  return parsed.success ? { kind: 'intake', record: parsed.data } : { kind: 'invalid' };
}

/**
 * Reads one restricted record (a conversation or an intake) under the
 * caller's own active emergency access record. The server authorizes
 * `records.read.emergency`, checks the window and scope, and audits every
 * read as `emergency_access.used`; the notice saying so stays at the top of
 * the dialog for as long as it is open.
 *
 * The body is held only by the mutation (`gcTime: 0`), is reset when the
 * dialog closes, and is never logged.
 */
export function RecordViewerDialog({ access, onClose, opsApi }: RecordViewerDialogProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const read = useReadEmergencyRecord(opsApi, access?.id ?? '');
  const [recordType, setRecordType] = useState<EmergencyRecordType>('conversation');
  const [recordId, setRecordId] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [apiError, setApiError] = useState<EmergencyErrorKey | null>(null);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const close = () => {
    read.reset();
    setErrors([]);
    setApiError(null);
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!access || read.isPending) return;
    const id = recordId.trim();
    if (!id) {
      setErrors([{ id: IDS.recordId, label: t('admin:emergency.record.recordId'), message: t('admin:emergency.errors.recordIdRequired') }]);
      return;
    }
    setErrors([]);
    setApiError(null);
    // A new read never shows the previous record while it loads or fails.
    read.reset();
    try {
      await read.mutateAsync({ recordType, recordId: id });
    } catch (err) {
      // A cancelled step-up (`null`) shows nothing.
      setApiError(emergencyErrorKey(err));
    }
  };

  const view = read.data ? toView(read.data) : null;

  return (
    <Dialog open={access !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        title={t('admin:emergency.record.title')}
        description={
          access
            ? t('admin:emergency.record.description', {
                scope: t(`admin:emergency.scopeKinds.${access.scopeKind}`),
                scopeId: access.scopeId,
              })
            : undefined
        }
        closeLabel={t('common:nav.close')}
        className="w-[min(calc(100%-2rem),48rem)]"
      >
        <div className="space-y-5">
          <Alert tone="warning" title={t('admin:emergency.record.auditedTitle')}>
            {t('admin:emergency.record.audited')}
          </Alert>

          <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={IDS.recordType} label={t('admin:emergency.record.recordType')}>
                <Select
                  options={EMERGENCY_RECORD_TYPES.map((type) => ({ value: type, label: t(`admin:emergency.recordTypes.${type}`) }))}
                  value={recordType}
                  onValueChange={(value) => value && setRecordType(value as EmergencyRecordType)}
                />
              </Field>
              <Field id={IDS.recordId} label={t('admin:emergency.record.recordId')} error={errorFor(IDS.recordId)} required>
                <Input value={recordId} onChange={(e) => setRecordId(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            <Button type="submit" loading={read.isPending}>
              {t('admin:emergency.record.submit')}
            </Button>
          </form>

          {apiError ? <Alert tone="danger">{t(`admin:emergency.errors.${apiError}`)}</Alert> : null}

          {view === null ? null : view.kind === 'invalid' ? (
            <Alert tone="danger">{t('admin:emergency.errors.unknown')}</Alert>
          ) : (
            <section aria-label={t('admin:emergency.record.contentLabel')} className="space-y-3 rounded-card border border-border-subtle p-4">
              {view.kind === 'conversation' ? (
                <>
                  <Heading level={3}>{t('admin:emergency.record.conversationHeading', { id: view.record.id })}</Heading>
                  <Text tone="secondary" typeRole="metadata">
                    {t('admin:emergency.record.caseLine', { caseId: view.record.caseId })}
                  </Text>
                  {view.record.messages.length === 0 ? (
                    <Text tone="secondary">{t('admin:emergency.record.noMessages')}</Text>
                  ) : (
                    <ol className="space-y-3">
                      {view.record.messages.map((message) => (
                        <li key={message.id} className="space-y-1 border-b border-border-subtle pb-3">
                          <Text tone="secondary" typeRole="metadata">
                            {t('admin:emergency.record.messageMeta', {
                              author: message.authorUserId,
                              time: formatDateTime(message.createdAt, locale),
                            })}
                          </Text>
                          <p className="type-body text-text whitespace-pre-wrap">{message.body}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <>
                  <Heading level={3}>{t('admin:emergency.record.intakeHeading', { id: view.record.id })}</Heading>
                  <Text tone="secondary" typeRole="metadata">
                    {t('admin:emergency.record.intakeMeta', {
                      caseId: view.record.caseId,
                      time: formatDateTime(view.record.createdAt, locale),
                    })}
                  </Text>
                  <p className="type-body text-text whitespace-pre-wrap">{view.record.body}</p>
                </>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

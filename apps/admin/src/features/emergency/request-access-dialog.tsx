import { useState } from 'react';
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
  Input,
  RadioGroup,
  RadioItem,
  Select,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { EmergencyAccessCreateRequestSchema, EMERGENCY_ACCESS_MAX_MINUTES } from '@nestself/contracts';
import type { EmergencyScopeKind } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { emergencyErrorKey } from './emergency-errors';
import type { EmergencyErrorKey } from './emergency-errors';
import { useRequestEmergencyAccess } from './use-emergency';

const IDS = {
  purpose: 'emergency-purpose',
  scopeId: 'emergency-scope-id',
  duration: 'emergency-duration',
  form: 'emergency-request-form',
} as const;
type FieldId = Exclude<(typeof IDS)[keyof typeof IDS], typeof IDS.form>;

/** The windows offered; the API accepts 15 to 240 minutes. */
const DURATION_OPTIONS = [15, 60, 120, EMERGENCY_ACCESS_MAX_MINUTES] as const;

export interface RequestAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
}

/**
 * Requests emergency access to one case or one user's records
 * (`access.emergency.request`, emergency step-up). The request waits for a
 * second staff member to approve it; the window starts at approval.
 */
export function RequestAccessDialog({ open, onOpenChange, opsApi }: RequestAccessDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const request = useRequestEmergencyAccess(opsApi);
  const [purpose, setPurpose] = useState('');
  const [scopeKind, setScopeKind] = useState<EmergencyScopeKind>('CASE');
  const [scopeId, setScopeId] = useState('');
  const [duration, setDuration] = useState<number>(EMERGENCY_ACCESS_MAX_MINUTES);
  const [errors, setErrors] = useState<FormError[]>([]);
  /** A refused request: shown above the fields, not tied to one of them. */
  const [apiError, setApiError] = useState<EmergencyErrorKey | null>(null);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const labels: Record<FieldId, string> = {
    [IDS.purpose]: t('admin:emergency.request.purpose'),
    [IDS.scopeId]: scopeKind === 'CASE' ? t('admin:emergency.request.caseId') : t('admin:emergency.request.userId'),
    [IDS.duration]: t('admin:emergency.request.duration'),
  };
  const problem = (id: FieldId, message: string): FormError => ({ id, label: labels[id], message });

  const close = () => {
    if (!request.isPending) onOpenChange(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (request.isPending) return;
    const body = { purpose: purpose.trim(), scopeKind, scopeId: scopeId.trim(), durationMinutes: duration };
    const problems: FormError[] = [];
    if (!EmergencyAccessCreateRequestSchema.shape.purpose.safeParse(body.purpose).success) {
      problems.push(problem(IDS.purpose, t('admin:emergency.errors.purposeLength')));
    }
    if (!body.scopeId) problems.push(problem(IDS.scopeId, t('admin:emergency.errors.scopeIdRequired')));
    setErrors(problems);
    setApiError(null);
    if (problems.length > 0) return;
    try {
      await request.mutateAsync(body);
      addToast({ title: t('admin:emergency.request.success'), tone: 'success' });
      onOpenChange(false);
    } catch (err) {
      const key = emergencyErrorKey(err);
      if (key === null) {
        onOpenChange(false);
        return;
      }
      setApiError(key);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={t('admin:emergency.request.title')}
        description={t('admin:emergency.request.description')}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          {apiError ? <Alert tone="danger">{t(`admin:emergency.errors.${apiError}`)}</Alert> : null}

          <Field
            id={IDS.purpose}
            label={labels[IDS.purpose]}
            description={t('admin:emergency.request.purposeHint')}
            error={errorFor(IDS.purpose)}
            required
          >
            <Textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>

          <RadioGroup
            label={t('admin:emergency.request.scopeKind')}
            value={scopeKind}
            onValueChange={(value) => setScopeKind(value as EmergencyScopeKind)}
          >
            <RadioItem value="CASE">{t('admin:emergency.scopeKinds.CASE')}</RadioItem>
            <RadioItem value="USER_RECORDS">{t('admin:emergency.scopeKinds.USER_RECORDS')}</RadioItem>
          </RadioGroup>

          <Field id={IDS.scopeId} label={labels[IDS.scopeId]} error={errorFor(IDS.scopeId)} required>
            <Input value={scopeId} onChange={(e) => setScopeId(e.target.value)} autoComplete="off" />
          </Field>

          <Field id={IDS.duration} label={labels[IDS.duration]} description={t('admin:emergency.request.durationHint')}>
            <Select
              options={DURATION_OPTIONS.map((m) => ({ value: String(m), label: t('admin:emergency.minutes', { minutes: m }) }))}
              value={String(duration)}
              onValueChange={(value) => value && setDuration(Number(value))}
            />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={request.isPending}>
              {t('admin:emergency.cancel')}
            </Button>
            <Button type="submit" loading={request.isPending}>
              {t('admin:emergency.request.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

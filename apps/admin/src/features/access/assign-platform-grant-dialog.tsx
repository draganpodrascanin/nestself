import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Input,
  Select,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { PlatformGrantCreateRequest } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { accessErrorKey, userErrorMessageKey } from './access-errors';
import type { AccessErrorKey } from './access-errors';
import { assignableTemplates, endOfDay, scopeLabel, templateLabel } from './access-labels';
import { useCreatePlatformGrant } from './use-ops-admin';

const IDS = {
  userId: 'platform-assign-user',
  template: 'platform-assign-template',
  form: 'platform-assign-form',
} as const;

/**
 * Staff templates. The server takes each at its own scope (`platform` or
 * `assigned_*`), so the scope is shown, not chosen. This dialog sends no
 * conditions, so templates with required condition types (content_reviewer)
 * are not offered until grant administration can collect them (X-D02). A
 * `missing_conditions` answer still renders its message.
 */
const STAFF_TEMPLATES = assignableTemplates('operations').filter(
  (tpl) => tpl.requiredConditionTypes.length === 0,
);

export interface AssignPlatformGrantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
}

export function AssignPlatformGrantDialog({ open, onOpenChange, opsApi }: AssignPlatformGrantDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const createGrant = useCreatePlatformGrant(opsApi);

  const [userId, setUserId] = useState('');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);

  const template = STAFF_TEMPLATES.find((tpl) => tpl.key === templateKey);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const close = () => {
    if (!createGrant.isPending) onOpenChange(false);
  };

  const userProblem = (message: string): FormError => ({ id: IDS.userId, label: t('admin:access.assign.userId'), message });
  const templateProblem = (message: string): FormError => ({ id: IDS.template, label: t('admin:access.assign.template'), message });

  const apiProblem = (key: AccessErrorKey): FormError => {
    const message = t(userErrorMessageKey(key));
    if (key === 'notFound') return userProblem(message);
    if (key === 'templateInactive' || key === 'missingConditions') return templateProblem(message);
    return { id: IDS.form, label: t('admin:access.assign.title'), message };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (createGrant.isPending) return;
    const subjectUserId = userId.trim();
    const problems: FormError[] = [];
    if (!subjectUserId) problems.push(userProblem(t('admin:access.errors.userIdRequired')));
    if (!template) problems.push(templateProblem(t('admin:access.errors.templateRequired')));
    setErrors(problems);
    if (problems.length > 0 || !template) return;

    const body: PlatformGrantCreateRequest = {
      templateKey: template.key,
      subjectUserId,
      scopeType: template.scopeType,
      conditions: [],
      ...(validUntil ? { validUntil: endOfDay(validUntil) } : {}),
    };
    try {
      await createGrant.mutateAsync(body);
      addToast({ title: t('admin:access.assign.success'), tone: 'success' });
      onOpenChange(false);
    } catch (err) {
      const key = accessErrorKey(err);
      if (key === null) {
        onOpenChange(false);
        return;
      }
      setErrors([apiProblem(key)]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent title={t('admin:access.assign.title')} closeLabel={t('common:nav.close')}>
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />

          <Field
            id={IDS.userId}
            label={t('admin:access.assign.userId')}
            description={t('admin:access.assign.userIdHint')}
            error={errorFor(IDS.userId)}
            required
          >
            <Input type="text" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="off" />
          </Field>

          <Field
            id={IDS.template}
            label={t('admin:access.assign.template')}
            description={template ? t('admin:access.platform.scopeOf', { scope: scopeLabel(t, template.scopeType) }) : undefined}
            error={errorFor(IDS.template)}
            required
          >
            <Select
              options={STAFF_TEMPLATES.map((tpl) => ({ value: tpl.key, label: templateLabel(t, tpl.key) }))}
              placeholder={t('admin:access.assign.choose')}
              onValueChange={setTemplateKey}
            />
          </Field>

          <Field label={t('admin:access.validity.validUntil')} optionalLabel={t('common:form.optional')}>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={createGrant.isPending}>
              {t('admin:access.assign.cancel')}
            </Button>
            <Button type="submit" loading={createGrant.isPending}>
              {t('admin:access.assign.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

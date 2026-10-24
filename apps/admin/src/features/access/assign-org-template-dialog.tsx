import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  ChipGroup,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Input,
  Select,
  Text,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { GrantCondition, GrantCreateRequest } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import type { AccessErrorKey } from './access-errors';
import { assignableTemplates, endOfDay, templateLabel } from './access-labels';
import type { AccessMember } from './access-labels';
import { useCreateOrgGrant } from './use-ops-admin';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/** Field ids, also the anchors of the error summary links. */
const IDS = {
  member: 'assign-member',
  template: 'assign-template',
  spendingCeiling: 'assign-spending-ceiling',
  categories: 'assign-categories',
  timeWindow: 'assign-time-window',
  form: 'assign-form',
} as const;

/**
 * Organization templates. Operations assigns them organization-wide only:
 * the ops API has no org-unit route, so scoping to a unit is left to HR in
 * the workspace.
 */
const ASSIGNABLE_TEMPLATES = assignableTemplates('organization');

export interface AssignOrgTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
  orgId: string;
  members: readonly AccessMember[];
}

export function AssignOrgTemplateDialog({ open, onOpenChange, opsApi, orgId, members }: AssignOrgTemplateDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const createGrant = useCreateOrgGrant(opsApi, orgId);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [categories, setCategories] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);

  const template = ASSIGNABLE_TEMPLATES.find((tpl) => tpl.key === templateKey);
  const required = new Set(template?.requiredConditionTypes ?? []);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;
  const message = (key: AccessErrorKey) => t(`admin:access.errors.${key}`);

  const close = () => {
    if (!createGrant.isPending) onOpenChange(false);
  };

  /** Builds the required conditions; `missing` names the first incomplete one. */
  const buildConditions = (): { conditions: GrantCondition[]; missing: string | null } => {
    const conditions: GrantCondition[] = [];
    let missing: string | null = null;
    if (required.has('spending_ceiling')) {
      const major = Number(amount.trim().replace(',', '.'));
      if (amount.trim() === '' || !Number.isFinite(major) || major < 0 || !CURRENCY_PATTERN.test(currency.trim())) {
        missing ??= IDS.spendingCeiling;
      } else {
        conditions.push({
          type: 'spending_ceiling',
          amountMinor: Math.round(major * 100),
          currency: currency.trim().toUpperCase(),
        });
      }
    }
    if (required.has('categories')) {
      const allowed = categories.split(',').map((c) => c.trim()).filter(Boolean);
      if (allowed.length === 0) missing ??= IDS.categories;
      else conditions.push({ type: 'categories', allowed });
    }
    if (required.has('time_window')) {
      if (days.length === 0 || !TIME_PATTERN.test(timeFrom) || !TIME_PATTERN.test(timeTo)) {
        missing ??= IDS.timeWindow;
      } else {
        conditions.push({ type: 'time_window', days: [...days].sort((a, b) => a - b), from: timeFrom, to: timeTo });
      }
    }
    if (required.has('confidential_approver')) conditions.push({ type: 'confidential_approver' });
    return { conditions, missing };
  };

  function conditionLabel(id: string): string {
    if (id === IDS.spendingCeiling) return t('admin:access.conditions.spendingCeiling');
    if (id === IDS.categories) return t('admin:access.conditions.categories');
    return t('admin:access.conditions.timeWindow');
  }

  const validate = (): { body: GrantCreateRequest | null; problems: FormError[] } => {
    const problems: FormError[] = [];
    if (!memberId) {
      problems.push({ id: IDS.member, label: t('admin:access.assign.member'), message: t('admin:access.errors.memberRequired') });
    }
    if (!template) {
      problems.push({ id: IDS.template, label: t('admin:access.assign.template'), message: t('admin:access.errors.templateRequired') });
    }
    const { conditions, missing } = buildConditions();
    if (missing) {
      problems.push({ id: missing, label: conditionLabel(missing), message: message('missingConditions') });
    }
    if (problems.length > 0 || !memberId || !template) return { body: null, problems };
    return {
      body: {
        templateKey: template.key,
        subjectUserId: memberId,
        scopeType: 'organization',
        includeDescendants: false,
        conditions,
        ...(validUntil ? { validUntil: endOfDay(validUntil) } : {}),
      },
      problems,
    };
  };

  /** Puts a server error next to the field it concerns, else on the form. */
  const apiProblem = (key: AccessErrorKey): FormError => {
    if (key === 'subjectNotMember') {
      return { id: IDS.member, label: t('admin:access.assign.member'), message: message(key) };
    }
    if (key === 'templateInactive' || key === 'missingConditions') {
      return { id: IDS.template, label: t('admin:access.assign.template'), message: message(key) };
    }
    return { id: IDS.form, label: t('admin:access.assign.title'), message: message(key) };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (createGrant.isPending) return;
    const { body, problems } = validate();
    setErrors(problems);
    if (!body) return;
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

  const toggleDay = (day: number, pressed: boolean) =>
    setDays((current) => (pressed ? [...current, day] : current.filter((d) => d !== day)));

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent title={t('admin:access.assign.title')} closeLabel={t('common:nav.close')}>
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />

          <Field id={IDS.member} label={t('admin:access.assign.member')} error={errorFor(IDS.member)} required>
            <Select
              options={members.map((m) => ({ value: m.userId, label: m.displayName }))}
              placeholder={t('admin:access.assign.choose')}
              onValueChange={setMemberId}
            />
          </Field>

          <Field id={IDS.template} label={t('admin:access.assign.template')} error={errorFor(IDS.template)} required>
            <Select
              options={ASSIGNABLE_TEMPLATES.map((tpl) => ({ value: tpl.key, label: templateLabel(t, tpl.key) }))}
              placeholder={t('admin:access.assign.choose')}
              onValueChange={setTemplateKey}
            />
          </Field>

          <Text tone="secondary">{t('admin:access.org.scopeNote')}</Text>

          {required.has('spending_ceiling') ? (
            <fieldset id={IDS.spendingCeiling} tabIndex={-1} className="space-y-2">
              <legend className="type-label text-text">{t('admin:access.conditions.spendingCeiling')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label={t('admin:access.conditions.amount')} error={errorFor(IDS.spendingCeiling)} required>
                  <Input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
                </Field>
                <Field label={t('admin:access.conditions.currency')} required>
                  <Input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} autoComplete="off" />
                </Field>
              </div>
            </fieldset>
          ) : null}

          {required.has('categories') ? (
            <Field
              id={IDS.categories}
              label={t('admin:access.conditions.categories')}
              description={t('admin:access.conditions.categoriesHint')}
              error={errorFor(IDS.categories)}
              required
            >
              <Input type="text" value={categories} onChange={(e) => setCategories(e.target.value)} autoComplete="off" />
            </Field>
          ) : null}

          {required.has('time_window') ? (
            <fieldset id={IDS.timeWindow} tabIndex={-1} className="space-y-2">
              <legend className="type-label text-text">{t('admin:access.conditions.timeWindow')}</legend>
              <ChipGroup label={t('admin:access.conditions.days')}>
                {DAYS.map((day) => (
                  <Chip key={day} pressed={days.includes(day)} onPressedChange={(p) => toggleDay(day, p)}>
                    {t(`admin:access.conditions.day.${day}`)}
                  </Chip>
                ))}
              </ChipGroup>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('admin:access.conditions.from')} error={errorFor(IDS.timeWindow)} required>
                  <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                </Field>
                <Field label={t('admin:access.conditions.to')} required>
                  <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
                </Field>
              </div>
            </fieldset>
          ) : null}

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

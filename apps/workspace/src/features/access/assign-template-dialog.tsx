import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  Chip,
  ChipGroup,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { PERMISSION_TEMPLATES } from '@nestself/contracts';
import type { GrantCondition, GrantCreateRequest, PermissionTemplateDefinition } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import type { AccessErrorKey } from './access-errors';
import { templateLabel } from './access-labels';
import type { AccessMember, AccessOrgUnit } from './access-labels';
import { useCreateGrant } from './use-org-admin';

type OrgScope = 'organization' | 'org_unit';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

/** Field ids, also the anchors of the error summary links. */
const IDS = {
  member: 'assign-member',
  template: 'assign-template',
  orgUnit: 'assign-org-unit',
  spendingCeiling: 'assign-spending-ceiling',
  categories: 'assign-categories',
  timeWindow: 'assign-time-window',
  form: 'assign-form',
} as const;

/** Templates an organization can assign from its own workspace. */
const ASSIGNABLE_TEMPLATES = PERMISSION_TEMPLATES.filter(
  (tpl) => tpl.workspace === 'organization' && tpl.isActive,
);

function defaultScope(tpl: PermissionTemplateDefinition | undefined): OrgScope {
  return tpl?.scopeType === 'org_unit' ? 'org_unit' : 'organization';
}

/** End of the chosen day in the user's time zone, as an ISO timestamp. */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59`).toISOString();
}

export interface AssignTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminApi: OrgAdminApi;
  orgId: string;
  members: readonly AccessMember[];
  orgUnits: readonly AccessOrgUnit[];
}

export function AssignTemplateDialog({
  open,
  onOpenChange,
  adminApi,
  orgId,
  members,
  orgUnits,
}: AssignTemplateDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const createGrant = useCreateGrant(adminApi, orgId);

  const [memberId, setMemberId] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [scope, setScope] = useState<OrgScope>('organization');
  const [orgUnitId, setOrgUnitId] = useState<string | null>(null);
  const [includeDescendants, setIncludeDescendants] = useState(false);
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
  const message = (key: AccessErrorKey) => t(`workspace:access.errors.${key}`);

  const close = () => {
    if (!createGrant.isPending) onOpenChange(false);
  };

  /** Builds the required conditions; `null` names the first incomplete one. */
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

  const validate = (): { body: GrantCreateRequest | null; problems: FormError[] } => {
    const problems: FormError[] = [];
    if (!memberId) {
      problems.push({ id: IDS.member, label: t('workspace:access.assign.member'), message: t('workspace:access.errors.memberRequired') });
    }
    if (!template) {
      problems.push({ id: IDS.template, label: t('workspace:access.assign.template'), message: t('workspace:access.errors.templateRequired') });
    }
    if (scope === 'org_unit' && !orgUnitId) {
      problems.push({ id: IDS.orgUnit, label: t('workspace:access.scope.unitLabel'), message: t('workspace:access.errors.orgUnitRequired') });
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
        scopeType: scope,
        ...(scope === 'org_unit' && orgUnitId ? { scopeOrgUnitId: orgUnitId } : {}),
        includeDescendants: scope === 'org_unit' ? includeDescendants : false,
        conditions,
        ...(validUntil ? { validUntil: endOfDay(validUntil) } : {}),
      },
      problems,
    };
  };

  function conditionLabel(id: string): string {
    if (id === IDS.spendingCeiling) return t('workspace:access.conditions.spendingCeiling');
    if (id === IDS.categories) return t('workspace:access.conditions.categories');
    return t('workspace:access.conditions.timeWindow');
  }

  /** Puts a server error next to the field it concerns, else on the form. */
  const apiProblem = (key: AccessErrorKey): FormError => {
    if (key === 'subjectNotMember') {
      return { id: IDS.member, label: t('workspace:access.assign.member'), message: message(key) };
    }
    if (key === 'templateInactive' || key === 'missingConditions') {
      return { id: IDS.template, label: t('workspace:access.assign.template'), message: message(key) };
    }
    return { id: IDS.form, label: t('workspace:access.assign.title'), message: message(key) };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (createGrant.isPending) return;
    const { body, problems } = validate();
    setErrors(problems);
    if (!body) return;
    try {
      await createGrant.mutateAsync(body);
      addToast({ title: t('workspace:access.assign.success'), tone: 'success' });
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
      <DialogContent title={t('workspace:access.assign.title')} closeLabel={t('common:nav.close')}>
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />

          <Field id={IDS.member} label={t('workspace:access.assign.member')} error={errorFor(IDS.member)} required>
            <Select
              options={members.map((m) => ({ value: m.userId, label: m.displayName }))}
              placeholder={t('workspace:access.assign.choose')}
              onValueChange={setMemberId}
            />
          </Field>

          <Field id={IDS.template} label={t('workspace:access.assign.template')} error={errorFor(IDS.template)} required>
            <Select
              options={ASSIGNABLE_TEMPLATES.map((tpl) => ({ value: tpl.key, label: templateLabel(t, tpl.key) }))}
              placeholder={t('workspace:access.assign.choose')}
              onValueChange={(key) => {
                setTemplateKey(key);
                setScope(defaultScope(ASSIGNABLE_TEMPLATES.find((tpl) => tpl.key === key)));
              }}
            />
          </Field>

          <RadioGroup
            label={t('workspace:access.scope.label')}
            value={scope}
            onValueChange={(value) => setScope(value as OrgScope)}
          >
            <RadioItem value="organization">{t('workspace:access.scope.organization')}</RadioItem>
            <RadioItem value="org_unit">{t('workspace:access.scope.orgUnit')}</RadioItem>
          </RadioGroup>

          {scope === 'org_unit' ? (
            <div className="space-y-2">
              <Field id={IDS.orgUnit} label={t('workspace:access.scope.unitLabel')} error={errorFor(IDS.orgUnit)} required>
                <Select
                  options={orgUnits.map((u) => ({ value: u.id, label: u.name }))}
                  placeholder={t('workspace:access.assign.choose')}
                  onValueChange={setOrgUnitId}
                />
              </Field>
              <Checkbox checked={includeDescendants} onCheckedChange={setIncludeDescendants}>
                {t('workspace:access.scope.includeDescendants')}
              </Checkbox>
            </div>
          ) : null}

          {required.has('spending_ceiling') ? (
            <fieldset id={IDS.spendingCeiling} tabIndex={-1} className="space-y-2">
              <legend className="type-label text-text">{t('workspace:access.conditions.spendingCeiling')}</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <Field label={t('workspace:access.conditions.amount')} error={errorFor(IDS.spendingCeiling)} required>
                  <Input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
                </Field>
                <Field label={t('workspace:access.conditions.currency')} required>
                  <Input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} autoComplete="off" />
                </Field>
              </div>
            </fieldset>
          ) : null}

          {required.has('categories') ? (
            <Field
              id={IDS.categories}
              label={t('workspace:access.conditions.categories')}
              description={t('workspace:access.conditions.categoriesHint')}
              error={errorFor(IDS.categories)}
              required
            >
              <Input type="text" value={categories} onChange={(e) => setCategories(e.target.value)} autoComplete="off" />
            </Field>
          ) : null}

          {required.has('time_window') ? (
            <fieldset id={IDS.timeWindow} tabIndex={-1} className="space-y-2">
              <legend className="type-label text-text">{t('workspace:access.conditions.timeWindow')}</legend>
              <ChipGroup label={t('workspace:access.conditions.days')}>
                {DAYS.map((day) => (
                  <Chip key={day} pressed={days.includes(day)} onPressedChange={(p) => toggleDay(day, p)}>
                    {t(`workspace:access.conditions.day.${day}`)}
                  </Chip>
                ))}
              </ChipGroup>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('workspace:access.conditions.from')} error={errorFor(IDS.timeWindow)} required>
                  <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                </Field>
                <Field label={t('workspace:access.conditions.to')} required>
                  <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
                </Field>
              </div>
            </fieldset>
          ) : null}

          <Field label={t('workspace:access.validity.validUntil')} optionalLabel={t('common:form.optional')}>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={createGrant.isPending}>
              {t('workspace:access.assign.cancel')}
            </Button>
            <Button type="submit" loading={createGrant.isPending}>
              {t('workspace:access.assign.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

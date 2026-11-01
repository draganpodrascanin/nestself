import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, FormErrorSummary, Heading, Input, Select, Skeleton, Switch, Text, Textarea, useToast } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { FeedbackRouteAdmin, FeedbackRouteUpdate, FeedbackRoutesAdminResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { useMembers } from '../access/use-org-admin';
import type { ListeningApi } from '../listening/listening-api';
import { listeningErrorMessageKey } from '../listening/listening-errors';
import { useOrgContext } from '../people/use-org-context';
import { categoryLabel } from './case-labels';
import { sampleFeedbackRoutesAdmin } from './sample-feedback';
import { useOrgFeedbackRoutes, useUpdateOrgFeedbackRoutes } from './use-feedback';

export interface RecipientsSettingsProps {
  listeningApi: ListeningApi;
  adminApi: OrgAdminApi;
  sampleMode: boolean;
}

/**
 * The organization's feedback recipients (spec FBK-03, FBK-06), for holders
 * of `org.settings`: the standard route's designated recipient, independent
 * alternative, categories and response target; the sensitive route only once
 * NestSelf has enabled it for the client, and then with monitored hours and
 * an escalation route. The server re-validates every rule.
 */
export function RecipientsSettings({ listeningApi, adminApi, sampleMode }: RecipientsSettingsProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { orgId, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useOrgFeedbackRoutes(listeningApi, apiOrgId);
  const members = useMembers(adminApi, apiOrgId);
  const data: FeedbackRoutesAdminResponse | undefined = sampleMode ? sampleFeedbackRoutesAdmin() : query.data;

  const header = (
    <div className="space-y-2">
      <Heading level={2} typeRole="sectionTitle">
        {t('listening:feedback.recipients.title')}
      </Heading>
      <Text tone="secondary">{t('listening:feedback.recipients.lead')}</Text>
    </div>
  );
  if (!sampleMode && (switchError || query.isError)) {
    const key = query.isError ? listeningErrorMessageKey(query.error) : null;
    return (
      <section className="space-y-4">
        {header}
        <Alert tone="danger">{key ? t(key) : t('listening:errors.unknown')}</Alert>
      </section>
    );
  }
  if (!data || orgId === null) {
    return (
      <section className="space-y-4">
        {header}
        <Skeleton lines={5} label={t('common:state.loading')} />
      </section>
    );
  }
  const standard = data.items.find((r) => r.kind === 'standard') ?? null;
  const sensitive = data.items.find((r) => r.kind === 'sensitive') ?? null;
  return (
    <section className="space-y-6">
      {header}
      {!data.feedbackEnabled ? <Alert tone="warning">{t('listening:feedback.recipients.channelOff')}</Alert> : null}
      <RouteForm
        key={`standard-${standard?.updatedAt ?? 'new'}`}
        listeningApi={listeningApi}
        orgId={orgId}
        sampleMode={sampleMode}
        kind="standard"
        route={standard}
        members={members.data ?? []}
        allowed
      />
      <RouteForm
        key={`sensitive-${sensitive?.updatedAt ?? 'new'}`}
        listeningApi={listeningApi}
        orgId={orgId}
        sampleMode={sampleMode}
        kind="sensitive"
        route={sensitive}
        members={members.data ?? []}
        allowed={data.sensitiveAllowed}
      />
    </section>
  );
}

interface RouteFormProps {
  listeningApi: ListeningApi;
  orgId: string;
  sampleMode: boolean;
  kind: 'standard' | 'sensitive';
  route: FeedbackRouteAdmin | null;
  members: readonly { userId: string; displayName: string }[];
  /** The sensitive route is editable only once NestSelf enabled it (spec FBK-06). */
  allowed: boolean;
}

function RouteForm({ listeningApi, orgId, sampleMode, kind, route, members, allowed }: RouteFormProps) {
  const { t } = useTranslation(['listening', 'common']);
  const { add: addToast } = useToast();
  const idPrefix = useId();
  const update = useUpdateOrgFeedbackRoutes(listeningApi, orgId);
  const [primary, setPrimary] = useState(route?.primaryHandlerUserId ?? '');
  const [alternate, setAlternate] = useState(route?.alternateHandlerUserId ?? '');
  const [enabled, setEnabled] = useState(route?.enabled ?? false);
  const [categories, setCategories] = useState((route?.categories ?? ['workload', 'management', 'communication', 'equipment', 'other']).join('\n'));
  const [target, setTarget] = useState(String(route?.responseTargetHours ?? 72));
  const [hours, setHours] = useState(route?.operatingHours ?? '');
  const [escalation, setEscalation] = useState(route?.escalationNote ?? '');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const ids = { primary: `${idPrefix}-primary`, alternate: `${idPrefix}-alternate`, categories: `${idPrefix}-categories`, target: `${idPrefix}-target`, hours: `${idPrefix}-hours`, escalation: `${idPrefix}-escalation` };
  const label = (key: string, opts?: Record<string, unknown>) => t(`listening:feedback.recipients.${key}`, opts);

  const memberOptions = members.map((m) => ({ value: m.userId, label: m.displayName }));
  // A current recipient who is no longer in the member page stays selectable by name.
  for (const [userId, name] of [
    [route?.primaryHandlerUserId, route?.primaryDisplayName],
    [route?.alternateHandlerUserId, route?.alternateDisplayName],
  ] as const) {
    if (userId && name && !memberOptions.some((o) => o.value === userId)) memberOptions.push({ value: userId, label: name });
  }
  const disabled = sampleMode || !allowed;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const problems: FormError[] = [];
    const list = categories.split('\n').map((c) => c.trim()).filter(Boolean);
    const hoursValue = Number(target);
    if (!primary) problems.push({ id: ids.primary, label: label('primary'), message: t('common:form.required') });
    if (!alternate) problems.push({ id: ids.alternate, label: label('alternate'), message: t('common:form.required') });
    if (primary && alternate && primary === alternate) problems.push({ id: ids.alternate, label: label('alternate'), message: t('listening:errors.same_handler') });
    if (list.length === 0) problems.push({ id: ids.categories, label: label('categories'), message: t('common:form.required') });
    if (!Number.isInteger(hoursValue) || hoursValue < 1 || hoursValue > 720) problems.push({ id: ids.target, label: label('responseTarget'), message: label('errors.target') });
    if (kind === 'sensitive' && enabled) {
      if (!hours.trim()) problems.push({ id: ids.hours, label: label('operatingHours'), message: t('common:form.required') });
      if (!escalation.trim()) problems.push({ id: ids.escalation, label: label('escalationNote'), message: t('common:form.required') });
    }
    setErrors(problems);
    setApiError(null);
    if (problems.length > 0) return;
    const body: FeedbackRouteUpdate = {
      kind,
      categories: list,
      primaryHandlerUserId: primary,
      alternateHandlerUserId: alternate,
      enabled,
      responseTargetHours: hoursValue,
      operatingHours: hours.trim() || null,
      escalationNote: escalation.trim() || null,
    };
    try {
      await update.mutateAsync({ routes: [body] });
      addToast({ title: label('saved'), tone: 'success' });
    } catch (err) {
      const key = listeningErrorMessageKey(err);
      if (key) setApiError(t(key));
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4 rounded-card border border-border-subtle p-4" aria-labelledby={`${idPrefix}-title`}>
      <div className="flex flex-wrap items-center gap-3">
        <Heading level={3} typeRole="sectionTitle" id={`${idPrefix}-title`}>
          {label(kind)}
        </Heading>
        {route ? <Badge tone={route.enabled ? 'success' : 'neutral'}>{route.enabled ? t('listening:settings.enabled') : t('listening:settings.disabled')}</Badge> : null}
      </div>
      {kind === 'sensitive' ? <Text tone="secondary">{label('sensitiveGate')}</Text> : null}
      {kind === 'sensitive' && !allowed ? <Alert tone="info">{label('sensitiveLocked')}</Alert> : null}
      {apiError ? <Alert tone="danger">{apiError}</Alert> : null}
      {errors.length > 0 ? <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} /> : null}
      {route && route.categories.length > 0 ? (
        <Text tone="secondary" typeRole="metadata">
          {label('currentCategories', { list: route.categories.map((c) => categoryLabel(t, c)).join(', ') })}
        </Text>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={label('primary')} id={ids.primary} error={errors.find((e) => e.id === ids.primary)?.message} required>
          <Select options={memberOptions} value={primary} placeholder={label('pickMember')} onValueChange={(v) => setPrimary(v ?? '')} disabled={disabled} />
        </Field>
        <Field label={label('alternate')} id={ids.alternate} error={errors.find((e) => e.id === ids.alternate)?.message} required>
          <Select options={memberOptions} value={alternate} placeholder={label('pickMember')} onValueChange={(v) => setAlternate(v ?? '')} disabled={disabled} />
        </Field>
        <Field label={label('responseTarget')} id={ids.target} error={errors.find((e) => e.id === ids.target)?.message} required>
          <Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} disabled={disabled} />
        </Field>
        <Field label={label('categories')} id={ids.categories} description={label('categoriesHint')} error={errors.find((e) => e.id === ids.categories)?.message} required>
          <Textarea value={categories} onChange={(e) => setCategories(e.target.value)} rows={4} disabled={disabled} />
        </Field>
        {kind === 'sensitive' ? (
          <>
            <Field label={label('operatingHours')} id={ids.hours} description={label('operatingHoursHint')} error={errors.find((e) => e.id === ids.hours)?.message}>
              <Input value={hours} onChange={(e) => setHours(e.target.value)} disabled={disabled} maxLength={200} />
            </Field>
            <Field label={label('escalationNote')} id={ids.escalation} description={label('escalationNoteHint')} error={errors.find((e) => e.id === ids.escalation)?.message}>
              <Textarea value={escalation} onChange={(e) => setEscalation(e.target.value)} rows={3} disabled={disabled} />
            </Field>
          </>
        ) : null}
      </div>
      <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled}>
        {label('enabled')}
      </Switch>
      <Text tone="secondary" typeRole="metadata">
        {label('eligibilityNote')}
      </Text>
      <div>
        <Button variant="primary" type="submit" disabled={disabled || update.isPending}>
          {label('save')}
        </Button>
      </div>
    </form>
  );
}

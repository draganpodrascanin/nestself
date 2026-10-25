import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Field, FormErrorSummary, Heading, Input, Text } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { OpsAdminApi } from '@nestself/api-client';
import type { UserAccessContext } from '@nestself/contracts';
import { accessErrorKey, userErrorMessageKey } from './access-errors';
import { groupByPrefix } from './access-labels';
import { sampleUserAccess } from './sample-access';
import { useUserAccess } from './use-ops-admin';
import { UserAccountActions } from '../users/user-account-actions';

const USER_ID_FIELD = 'lookup-user-id';

type HeadingLevel = 2 | 3;

export interface UserAccessLookupProps {
  opsApi: OpsAdminApi;
  /** False while the session is not yet in the operations context. */
  enabled: boolean;
  sampleMode: boolean;
  headingLevel: HeadingLevel;
}

/** Evaluated access of any user, one section per context (`userAccess`). */
export function UserAccessLookup({ opsApi, enabled, sampleMode, headingLevel }: UserAccessLookupProps) {
  const { t } = useTranslation(['admin', 'common']);
  const headingId = useId();
  const [draft, setDraft] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  const query = useUserAccess(opsApi, !sampleMode && enabled ? userId : null);

  const sampleContexts = sampleMode && userId ? sampleUserAccess(userId) : undefined;
  const contexts: UserAccessContext[] | undefined = sampleMode ? (sampleContexts ?? undefined) : query.data?.contexts;
  // Sample people are never suspended.
  const suspended = sampleMode ? false : (query.data?.suspended ?? false);
  const errorKey = sampleMode
    ? sampleContexts === null
      ? 'notFound'
      : null
    : query.isError
      ? (accessErrorKey(query.error) ?? 'unknown')
      : null;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const id = draft.trim();
    if (!id) {
      setErrors([{ id: USER_ID_FIELD, label: t('admin:access.lookup.userId'), message: t('admin:access.errors.userIdRequired') }]);
      return;
    }
    setErrors([]);
    setUserId(id);
  };

  const contextTitle = (context: UserAccessContext) =>
    context.orgId === null
      ? t('admin:access.lookup.platform')
      : t('admin:access.lookup.organization', { orgId: context.orgId });

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <Heading level={headingLevel} id={headingId}>
        {t('admin:access.lookup.title')}
      </Heading>
      <Text tone="secondary">{t('admin:access.lookup.lead')}</Text>
      <form noValidate onSubmit={handleSubmit} className="space-y-3 max-w-md">
        <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
        <Field id={USER_ID_FIELD} label={t('admin:access.lookup.userId')} error={errors[0]?.message} required>
          <Input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" variant="secondary" disabled={!sampleMode && !enabled}>
          {t('admin:access.lookup.submit')}
        </Button>
      </form>

      {errorKey ? (
        <Alert tone="danger">{t(userErrorMessageKey(errorKey))}</Alert>
      ) : userId && !sampleMode && query.isPending ? (
        <Text tone="secondary">{t('admin:access.lookup.loading')}</Text>
      ) : contexts && userId ? (
        <div className="space-y-6">
          <UserAccountActions
            opsApi={opsApi}
            userId={userId}
            suspended={suspended}
            sampleMode={sampleMode}
            headingLevel={(headingLevel + 1) as 3 | 4}
          />
          {contexts.length === 0 ? <Text tone="secondary">{t('admin:access.lookup.empty')}</Text> : null}
          {contexts.map((context) => (
            <ContextSection
              key={context.orgId ?? 'platform'}
              title={contextTitle(context)}
              actions={context.actions}
              headingLevel={(headingLevel + 1) as 3 | 4}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ContextSection({ title, actions, headingLevel }: { title: string; actions: readonly string[]; headingLevel: 3 | 4 }) {
  const { t } = useTranslation(['admin', 'common']);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <Heading level={headingLevel} id={headingId}>
        {title}
      </Heading>
      {actions.length === 0 ? (
        <Text tone="secondary">{t('admin:access.lookup.noActions')}</Text>
      ) : (
        groupByPrefix(actions).map(([prefix, group]) => (
          <div key={prefix} className="space-y-1">
            <Text typeRole="label">{prefix}</Text>
            <ul aria-label={prefix} className="flex flex-wrap gap-2">
              {group.map((action) => (
                <li key={action}>
                  <Badge>{action}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

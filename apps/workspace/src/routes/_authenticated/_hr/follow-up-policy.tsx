/**
 * `/follow-up-policy`: HR chooses what a confirmed follow-up does (T-CW-1.10,
 * D-CW-37, CALL-41): booked at once (`automatic`) or decided by the
 * employee's approver first (`manager_approval`). Under the `_hr` gate
 * (`program.overview`); the server requires the same action on the
 * organization, so the gate is a convenience only.
 *
 * Both choices are explained in plain words, including what an approver sees
 * and what happens when a team has no approver. A failed load or save is
 * translated copy in an alert. Sample mode reads nothing, saves nothing and
 * says so.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Heading, RadioGroup, RadioItem, StatusBlock, useToast } from '@nestself/ui';
import { followUpPolicyKeys, followUpPolicyQuery, setFollowUpPolicyMutation } from '@nestself/api-client';
import type { CallsApi } from '@nestself/api-client';
import { FOLLOW_UP_APPROVAL_POLICY_DEFAULT, FollowUpApprovalPolicySchema } from '@nestself/contracts';
import type { FollowUpApprovalPolicy } from '@nestself/contracts';
import { useAuth } from '../../../auth';
import { callsApi } from '../../../calls/calls-api';
import { mapCallError } from '../../../calls/map-call-error';
import { isSampleDataMode } from '../../../data-source';
import type { TFunction } from 'i18next';

type CallsT = TFunction<'calls'>;

export const Route = createFileRoute('/_authenticated/_hr/follow-up-policy')({
  component: FollowUpPolicyPage,
});

function FollowUpPolicyPage() {
  return <FollowUpPolicyScreen api={callsApi} sampleMode={isSampleDataMode} />;
}

function PolicyOption({ title, body }: { title: string; body: string }) {
  return (
    <span className="gap-1 py-2 flex flex-col">
      <span className="type-label text-text">{title}</span>
      <span className="type-metadata text-text-secondary">{body}</span>
    </span>
  );
}

function FollowUpPolicyScreen({ api, sampleMode }: { api: CallsApi; sampleMode: boolean }) {
  const { t } = useTranslation(['calls', 'common']);
  const { principal } = useAuth();
  const { add: addToast } = useToast();
  const queryClient = useQueryClient();
  const orgId = principal?.context.kind === 'organization' ? principal.context.orgId : null;
  const enabled = !sampleMode && orgId !== null;
  const policy = useQuery({ ...followUpPolicyQuery(api, orgId ?? ''), enabled });
  const save = useMutation(setFollowUpPolicyMutation(api, orgId ?? ''));
  const saved: FollowUpApprovalPolicy = sampleMode ? FOLLOW_UP_APPROVAL_POLICY_DEFAULT : (policy.data?.policy ?? FOLLOW_UP_APPROVAL_POLICY_DEFAULT);
  /** The unsaved choice; null shows the saved policy. */
  const [draft, setDraft] = useState<FollowUpApprovalPolicy | null>(null);
  const choice = draft ?? saved;
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveError(null);
    if (sampleMode) {
      addToast({ title: t('calls:approval.policy.sampleSaved'), tone: 'info' });
      return;
    }
    if (!orgId) return;
    try {
      const result = await save.mutateAsync(choice);
      queryClient.setQueryData(followUpPolicyKeys.detail(orgId), result);
      setDraft(null);
      addToast({ title: t('calls:approval.policy.saved'), tone: 'success' });
    } catch (err) {
      setSaveError(mapCallError(err, t as CallsT));
    }
  };

  const loading = enabled && policy.isPending;
  const loadFailed = enabled && policy.isError;

  return (
    <div className="space-y-8 max-w-2xl">
      <div className="space-y-2">
        <Heading level={1} typeRole="screenTitle">
          {t('calls:approval.policy.title')}
        </Heading>
        <p className="type-body text-text-secondary">{t('calls:approval.policy.intro')}</p>
      </div>

      {sampleMode ? <Alert tone="info">{t('calls:approval.policy.sampleNote')}</Alert> : null}

      {!sampleMode && orgId === null ? (
        <Alert tone="info">{t('calls:approval.noOrganization')}</Alert>
      ) : loading ? (
        <StatusBlock state="loading" title={t('common:state.loading')} body="" />
      ) : loadFailed ? (
        <Alert tone="danger" title={t('calls:approval.policy.loadFailedTitle')}>
          <p>{mapCallError(policy.error, t as CallsT)}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void policy.refetch()}>
            {t('calls:approval.retry')}
          </Button>
        </Alert>
      ) : (
        <div className="space-y-6">
          {saveError ? (
            <Alert tone="danger" title={t('calls:approval.policy.saveFailedTitle')}>
              {saveError}
            </Alert>
          ) : null}
          <RadioGroup
            label={t('calls:approval.policy.label')}
            name="followUpApprovalPolicy"
            value={choice}
            onValueChange={(value) => {
              const parsed = FollowUpApprovalPolicySchema.safeParse(value);
              if (parsed.success) setDraft(parsed.data);
            }}
            disabled={save.isPending}
            className="gap-4"
          >
            <RadioItem value="automatic" className="items-start">
              <PolicyOption title={t('calls:approval.policy.automaticTitle')} body={t('calls:approval.policy.automaticBody')} />
            </RadioItem>
            <RadioItem value="manager_approval" className="items-start">
              <PolicyOption title={t('calls:approval.policy.managerTitle')} body={t('calls:approval.policy.managerBody')} />
            </RadioItem>
          </RadioGroup>
          <Button onClick={() => void handleSave()} loading={save.isPending} disabled={!sampleMode && choice === saved}>
            {t('calls:approval.policy.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

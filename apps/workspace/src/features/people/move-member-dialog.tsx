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
  Select,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { MemberItem, MemberUpdateRequest, OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { peopleErrorKey, validationFields } from './people-errors';
import type { PeopleErrorKey } from './people-errors';
import { useUpdateMember } from './use-people';

/** Select value for "no line manager". */
const NONE = '__none__';

const IDS = {
  orgUnit: 'move-org-unit',
  lineManager: 'move-line-manager',
  form: 'move-form',
} as const;

export interface MoveMemberDialogProps {
  /** The member to move; `null` keeps the dialog closed. */
  member: MemberItem | null;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
  orgUnits: readonly OrgUnitResponse[];
  /** Active members who can be chosen as line manager. */
  managers: readonly MemberItem[];
}

export function MoveMemberDialog(props: MoveMemberDialogProps) {
  // Fresh form state for every member the dialog opens for.
  return <MoveMemberForm key={props.member?.membershipId ?? 'closed'} {...props} />;
}

function MoveMemberForm({ member, onClose, adminApi, orgId, orgUnits, managers }: MoveMemberDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const updateMember = useUpdateMember(adminApi, orgId);
  const [orgUnitId, setOrgUnitId] = useState<string | null>(member?.orgUnitId ?? null);
  const [managerId, setManagerId] = useState<string>(member?.lineManagerUserId ?? NONE);
  const [errors, setErrors] = useState<FormError[]>([]);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const labels = {
    [IDS.orgUnit]: t('workspace:people.move.orgUnit'),
    [IDS.lineManager]: t('workspace:people.move.lineManager'),
    [IDS.form]: t('workspace:people.move.title'),
  };
  const problem = (id: keyof typeof labels, message: string): FormError => ({ id, label: labels[id], message });

  const close = () => {
    if (!updateMember.isPending) onClose();
  };

  /** Puts a server error next to the field it concerns, else on the form. */
  const apiProblems = (key: PeopleErrorKey, err: unknown): FormError[] => {
    const message = t(`workspace:people.errors.${key}`);
    if (key === 'subjectNotMember') return [problem(IDS.lineManager, message)];
    if (key === 'validation') {
      const fields = validationFields(err);
      const named: FormError[] = [];
      if (fields.includes('orgUnitId')) named.push(problem(IDS.orgUnit, message));
      if (fields.includes('lineManagerUserId')) named.push(problem(IDS.lineManager, message));
      if (named.length > 0) return named;
    }
    return [problem(IDS.form, message)];
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!member || updateMember.isPending) return;
    const body: MemberUpdateRequest = {};
    if (orgUnitId && orgUnitId !== member.orgUnitId) body.orgUnitId = orgUnitId;
    const nextManager = managerId === NONE ? null : managerId;
    if (nextManager !== member.lineManagerUserId) body.lineManagerUserId = nextManager;
    if (Object.keys(body).length === 0) {
      setErrors([problem(IDS.form, t('workspace:people.errors.noChange'))]);
      return;
    }
    setErrors([]);
    try {
      await updateMember.mutateAsync({ membershipId: member.membershipId, ...body });
      addToast({ title: t('workspace:people.move.success', { name: member.displayName }), tone: 'success' });
      onClose();
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) {
        onClose();
        return;
      }
      setErrors(apiProblems(key, err));
    }
  };

  const managerOptions = [
    { value: NONE, label: t('workspace:people.move.noLineManager') },
    ...managers
      .filter((m) => m.userId !== member?.userId)
      .map((m) => ({ value: m.userId, label: m.displayName })),
  ];

  return (
    <Dialog open={member !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        title={t('workspace:people.move.title')}
        description={member ? t('workspace:people.move.description', { name: member.displayName }) : undefined}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />

          <Field id={IDS.orgUnit} label={labels[IDS.orgUnit]} error={errorFor(IDS.orgUnit)}>
            <Select
              options={orgUnits.map((u) => ({ value: u.id, label: u.name }))}
              placeholder={t('workspace:people.choose')}
              {...(orgUnitId ? { value: orgUnitId } : {})}
              onValueChange={setOrgUnitId}
            />
          </Field>

          <Field id={IDS.lineManager} label={labels[IDS.lineManager]} error={errorFor(IDS.lineManager)}>
            <Select
              options={managerOptions}
              value={managerId}
              onValueChange={(v) => setManagerId(v ?? NONE)}
            />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={updateMember.isPending}>
              {t('workspace:people.cancel')}
            </Button>
            <Button type="submit" loading={updateMember.isPending}>
              {t('workspace:people.move.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Select,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { GrantResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { accessErrorKey } from './access-errors';
import type { AccessMember } from './access-labels';
import { useDelegateGrant } from './use-org-admin';

const IDS = {
  member: 'delegate-member',
  actions: 'delegate-actions',
  form: 'delegate-form',
} as const;

export interface DelegateGrantDialogProps {
  /** The signed-in user's own grant to delegate from; `null` keeps the dialog closed. */
  parent: GrantResponse | null;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
  /** Members who can receive the delegation (the delegator is left out). */
  members: readonly AccessMember[];
}

/**
 * Delegates part of the signed-in user's own grant: a subset of its actions,
 * within its scope and conditions. The server rejects anything wider with
 * `delegation_exceeds_boundary`.
 */
export function DelegateGrantDialog({ parent, onClose, adminApi, orgId, members }: DelegateGrantDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  const delegateGrant = useDelegateGrant(adminApi, orgId);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormError[]>([]);

  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const close = () => {
    if (delegateGrant.isPending) return;
    setMemberId(null);
    setActions([]);
    setErrors([]);
    onClose();
  };

  const toggle = (action: string, checked: boolean) =>
    setActions((current) => (checked ? [...current, action] : current.filter((a) => a !== action)));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parent || delegateGrant.isPending) return;
    const problems: FormError[] = [];
    if (!memberId) {
      problems.push({ id: IDS.member, label: t('workspace:access.delegate.member'), message: t('workspace:access.errors.memberRequired') });
    }
    if (actions.length === 0) {
      problems.push({ id: IDS.actions, label: t('workspace:access.delegate.actions'), message: t('workspace:access.errors.actionsRequired') });
    }
    setErrors(problems);
    if (problems.length > 0 || !memberId) return;
    try {
      await delegateGrant.mutateAsync({
        parentGrantId: parent.id,
        subjectUserId: memberId,
        actions: parent.actions.filter((a) => actions.includes(a)),
        conditions: parent.conditions,
      });
      addToast({ title: t('workspace:access.delegate.success'), tone: 'success' });
      close();
    } catch (err) {
      const key = accessErrorKey(err);
      if (key === null) {
        close();
        return;
      }
      const id = key === 'subjectNotMember' ? IDS.member : IDS.form;
      const label = key === 'subjectNotMember' ? t('workspace:access.delegate.member') : t('workspace:access.delegate.title');
      setErrors([{ id, label, message: t(`workspace:access.errors.${key}`) }]);
    }
  };

  return (
    <Dialog open={parent !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent
        title={t('workspace:access.delegate.title')}
        description={t('workspace:access.delegate.description')}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field id={IDS.member} label={t('workspace:access.delegate.member')} error={errorFor(IDS.member)} required>
            <Select
              options={members.map((m) => ({ value: m.userId, label: m.displayName }))}
              placeholder={t('workspace:access.assign.choose')}
              onValueChange={setMemberId}
            />
          </Field>
          <div id={IDS.actions} tabIndex={-1}>
            <CheckboxGroup legend={t('workspace:access.delegate.actions')}>
              {(parent?.actions ?? []).map((action) => (
                <Checkbox key={action} checked={actions.includes(action)} onCheckedChange={(c) => toggle(action, c)}>
                  {action}
                </Checkbox>
              ))}
            </CheckboxGroup>
            {errorFor(IDS.actions) ? (
              <p className="mt-1 type-metadata text-danger">{errorFor(IDS.actions)}</p>
            ) : null}
          </div>
          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={delegateGrant.isPending}>
              {t('workspace:access.delegate.cancel')}
            </Button>
            <Button type="submit" loading={delegateGrant.isPending}>
              {t('workspace:access.delegate.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

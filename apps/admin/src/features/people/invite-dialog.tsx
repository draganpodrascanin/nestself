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
import { InvitationCreateRequestSchema } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { templateLabel } from '../access/access-labels';
import { peopleErrorKey, validationFields } from './people-errors';
import type { PeopleErrorKey } from './people-errors';
import { INVITABLE_TEMPLATES } from './people-labels';
import { useCreateInvitation } from './use-ops-people';

const IDS = {
  email: 'invite-email',
  template: 'invite-template',
  form: 'invite-form',
} as const;
type FieldId = (typeof IDS)[keyof typeof IDS];

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
  orgId: string;
}

/**
 * Invites one person through the operations route (`people.onboard`). The
 * operations workspace has no org-unit list, so the invitation is
 * organization-wide; HR places the person later.
 */
export function InviteDialog({ open, onOpenChange, opsApi, orgId }: InviteDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const createInvitation = useCreateInvitation(opsApi, orgId);
  const [email, setEmail] = useState('');
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const labels: Record<FieldId, string> = {
    [IDS.email]: t('admin:people.invite.email'),
    [IDS.template]: t('admin:people.invite.template'),
    [IDS.form]: t('admin:people.invite.title'),
  };
  const problem = (id: FieldId, message: string): FormError => ({ id, label: labels[id], message });

  const close = () => {
    if (!createInvitation.isPending) onOpenChange(false);
  };

  /** Puts a server error next to the field it concerns, else on the form. */
  const apiProblems = (key: PeopleErrorKey, err: unknown): FormError[] => {
    const message = t(`admin:people.errors.${key}`);
    if (key === 'duplicateInvitation' || key === 'alreadyMember') return [problem(IDS.email, message)];
    if (key === 'ownerExists') return [problem(IDS.template, message)];
    if (key === 'validation') {
      const fields = validationFields(err);
      const named: FormError[] = [];
      if (fields.includes('email')) named.push(problem(IDS.email, t('admin:people.errors.emailInvalid')));
      if (fields.includes('templateKey')) named.push(problem(IDS.template, t('admin:people.errors.templateInvalid')));
      if (named.length > 0) return named;
    }
    return [problem(IDS.form, message)];
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (createInvitation.isPending) return;
    const problems: FormError[] = [];
    const parsedEmail = InvitationCreateRequestSchema.shape.email.safeParse(email.trim());
    if (!parsedEmail.success) problems.push(problem(IDS.email, t('admin:people.errors.emailInvalid')));
    if (!templateKey) problems.push(problem(IDS.template, t('admin:people.errors.templateRequired')));
    setErrors(problems);
    if (problems.length > 0 || !parsedEmail.success || !templateKey) return;
    try {
      await createInvitation.mutateAsync({ email: parsedEmail.data, templateKey });
      addToast({ title: t('admin:people.invite.success', { email: parsedEmail.data }), tone: 'success' });
      onOpenChange(false);
    } catch (err) {
      const key = peopleErrorKey(err);
      if (key === null) {
        onOpenChange(false);
        return;
      }
      setErrors(apiProblems(key, err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={t('admin:people.invite.title')}
        description={t('admin:people.invite.description')}
        closeLabel={t('common:nav.close')}
      >
        <form id={IDS.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />

          <Field id={IDS.email} label={labels[IDS.email]} error={errorFor(IDS.email)} required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>

          <Field id={IDS.template} label={labels[IDS.template]} error={errorFor(IDS.template)} required>
            <Select
              options={INVITABLE_TEMPLATES.map((tpl) => ({ value: tpl.key, label: templateLabel(t, tpl.key) }))}
              placeholder={t('admin:people.choose')}
              onValueChange={setTemplateKey}
            />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={createInvitation.isPending}>
              {t('admin:people.cancel')}
            </Button>
            <Button type="submit" loading={createInvitation.isPending}>
              {t('admin:people.invite.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

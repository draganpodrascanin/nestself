import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
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
import type { OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { validationFields } from '../people/people-errors';
import { orgUnitErrorKey } from './org-units-errors';
import { subtreeIds } from './org-unit-tree';
import { useCreateOrgUnit, useMoveOrgUnit, useRenameOrgUnit } from './use-org-units';

const NAME_MAX = 200;
/** Kinds a unit can be created with; the COMPANY root comes with the organization. */
const CHILD_KINDS = ['DEPARTMENT', 'TEAM'] as const;
type ChildKind = (typeof CHILD_KINDS)[number];

export type OrgUnitAction =
  | { kind: 'rename'; unit: OrgUnitResponse }
  | { kind: 'addChild'; unit: OrgUnitResponse }
  | { kind: 'move'; unit: OrgUnitResponse };

export interface OrgUnitDialogProps {
  /** The action in progress; `null` keeps the dialog closed. */
  action: OrgUnitAction | null;
  onClose: () => void;
  adminApi: OrgAdminApi;
  orgId: string;
  units: readonly OrgUnitResponse[];
}

export function OrgUnitDialog(props: OrgUnitDialogProps) {
  const { action } = props;
  const key = action ? `${action.kind}-${action.unit.id}` : 'closed';
  if (!action) return null;
  if (action.kind === 'rename') return <RenameForm key={key} {...props} unit={action.unit} />;
  if (action.kind === 'addChild') return <AddChildForm key={key} {...props} unit={action.unit} />;
  return <MoveForm key={key} {...props} unit={action.unit} />;
}

type FormProps = OrgUnitDialogProps & { unit: OrgUnitResponse };

/** Dialog chrome shared by the three forms. */
function UnitDialogShell({
  formId,
  title,
  description,
  errors,
  pending,
  submitLabel,
  onClose,
  onSubmit,
  children,
}: {
  formId: string;
  title: string;
  description: string;
  errors: FormError[];
  pending: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation(['workspace', 'common']);
  const close = () => {
    if (!pending) onClose();
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!pending) void onSubmit();
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent title={title} description={description} closeLabel={t('common:nav.close')}>
        <form id={formId} tabIndex={-1} noValidate onSubmit={handleSubmit} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          {children}
          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>
              {t('workspace:orgUnits.cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {submitLabel}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Runs a mutation and turns a failure into form errors; a cancelled step-up closes quietly. */
function useSubmit(onClose: () => void) {
  const { t } = useTranslation(['workspace', 'common']);
  const { add: addToast } = useToast();
  return async (
    run: () => Promise<unknown>,
    success: string,
    fieldFor: (fields: string[]) => FormError | null,
    formError: (message: string) => FormError,
  ): Promise<FormError[]> => {
    try {
      await run();
      addToast({ title: success, tone: 'success' });
      onClose();
      return [];
    } catch (err) {
      const key = orgUnitErrorKey(err);
      if (key === null) {
        onClose();
        return [];
      }
      const message = t(`workspace:orgUnits.errors.${key}`);
      if (key === 'validation') {
        const named = fieldFor(validationFields(err));
        if (named) return [{ ...named, message }];
      }
      return [formError(message)];
    }
  };
}

function nameProblem(name: string, label: string, id: string, t: (k: string) => string): FormError | null {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
    return { id, label, message: t('workspace:orgUnits.errors.nameLength') };
  }
  return null;
}

function RenameForm({ unit, onClose, adminApi, orgId }: FormProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const rename = useRenameOrgUnit(adminApi, orgId);
  const submit = useSubmit(onClose);
  const [name, setName] = useState(unit.name);
  const [errors, setErrors] = useState<FormError[]>([]);
  const ids = { name: 'rename-name', form: 'rename-form' };
  const nameLabel = t('workspace:orgUnits.fields.name');

  const onSubmit = async () => {
    const invalid = nameProblem(name, nameLabel, ids.name, t);
    if (invalid) return setErrors([invalid]);
    if (name.trim() === unit.name) {
      return setErrors([{ id: ids.form, label: t('workspace:orgUnits.rename.title'), message: t('workspace:orgUnits.errors.noChange') }]);
    }
    setErrors([]);
    setErrors(
      await submit(
        () => rename.mutateAsync({ unitId: unit.id, name: name.trim() }),
        t('workspace:orgUnits.rename.success', { name: name.trim() }),
        (fields) => (fields.includes('name') ? { id: ids.name, label: nameLabel, message: '' } : null),
        (message) => ({ id: ids.form, label: t('workspace:orgUnits.rename.title'), message }),
      ),
    );
  };

  return (
    <UnitDialogShell
      formId={ids.form}
      title={t('workspace:orgUnits.rename.title')}
      description={t('workspace:orgUnits.rename.description', { name: unit.name })}
      errors={errors}
      pending={rename.isPending}
      submitLabel={t('workspace:orgUnits.rename.submit')}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <Field id={ids.name} label={nameLabel} error={errors.find((e) => e.id === ids.name)?.message} required>
        <Input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
    </UnitDialogShell>
  );
}

function AddChildForm({ unit, onClose, adminApi, orgId }: FormProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const create = useCreateOrgUnit(adminApi, orgId);
  const submit = useSubmit(onClose);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ChildKind>(unit.kind === 'DEPARTMENT' ? 'TEAM' : 'DEPARTMENT');
  const [errors, setErrors] = useState<FormError[]>([]);
  const ids = { name: 'add-name', kind: 'add-kind', form: 'add-form' };
  const nameLabel = t('workspace:orgUnits.fields.name');
  const kindLabel = t('workspace:orgUnits.fields.kind');

  const onSubmit = async () => {
    const invalid = nameProblem(name, nameLabel, ids.name, t);
    if (invalid) return setErrors([invalid]);
    setErrors([]);
    setErrors(
      await submit(
        () => create.mutateAsync({ parentId: unit.id, kind, name: name.trim() }),
        t('workspace:orgUnits.addChild.success', { name: name.trim() }),
        (fields) =>
          fields.includes('name')
            ? { id: ids.name, label: nameLabel, message: '' }
            : fields.includes('kind')
              ? { id: ids.kind, label: kindLabel, message: '' }
              : null,
        (message) => ({ id: ids.form, label: t('workspace:orgUnits.addChild.title'), message }),
      ),
    );
  };

  return (
    <UnitDialogShell
      formId={ids.form}
      title={t('workspace:orgUnits.addChild.title')}
      description={t('workspace:orgUnits.addChild.description', { name: unit.name })}
      errors={errors}
      pending={create.isPending}
      submitLabel={t('workspace:orgUnits.addChild.submit')}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <Field id={ids.name} label={nameLabel} error={errors.find((e) => e.id === ids.name)?.message} required>
        <Input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id={ids.kind} label={kindLabel} error={errors.find((e) => e.id === ids.kind)?.message} required>
        <Select
          options={CHILD_KINDS.map((k) => ({ value: k, label: t(`workspace:orgUnits.kinds.${k}`) }))}
          value={kind}
          onValueChange={(v) => {
            if (v) setKind(v as ChildKind);
          }}
        />
      </Field>
    </UnitDialogShell>
  );
}

function MoveForm({ unit, onClose, adminApi, orgId, units }: FormProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const move = useMoveOrgUnit(adminApi, orgId);
  const submit = useSubmit(onClose);
  const [parentId, setParentId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormError[]>([]);
  const ids = { parent: 'move-parent', form: 'move-unit-form' };
  const parentLabel = t('workspace:orgUnits.fields.parent');

  // Not itself, not below itself (a cycle), not where it already is.
  const excluded = subtreeIds(units, unit.id);
  const options = units
    .filter((u) => !excluded.has(u.id) && u.id !== unit.parentId && u.archivedAt === null)
    .map((u) => ({ value: u.id, label: u.name }));

  const onSubmit = async () => {
    if (!parentId) {
      return setErrors([{ id: ids.parent, label: parentLabel, message: t('workspace:orgUnits.errors.parentRequired') }]);
    }
    setErrors([]);
    const parentName = units.find((u) => u.id === parentId)?.name ?? '';
    setErrors(
      await submit(
        () => move.mutateAsync({ unitId: unit.id, parentId }),
        t('workspace:orgUnits.move.success', { name: unit.name, parent: parentName }),
        (fields) => (fields.includes('parentId') ? { id: ids.parent, label: parentLabel, message: '' } : null),
        (message) => ({ id: ids.form, label: t('workspace:orgUnits.move.title'), message }),
      ),
    );
  };

  return (
    <UnitDialogShell
      formId={ids.form}
      title={t('workspace:orgUnits.move.title')}
      description={t('workspace:orgUnits.move.description', { name: unit.name })}
      errors={errors}
      pending={move.isPending}
      submitLabel={t('workspace:orgUnits.move.submit')}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <Field id={ids.parent} label={parentLabel} error={errors.find((e) => e.id === ids.parent)?.message} required>
        <Select options={options} placeholder={t('workspace:orgUnits.choose')} onValueChange={setParentId} />
      </Field>
    </UnitDialogShell>
  );
}

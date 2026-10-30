import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, DialogActions, DialogContent, Field, FormErrorSummary, Input, Text } from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { SsoDomainResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { CopyValue } from './copy-value';
import { ssoProblem } from './sso-errors';
import type { SsoErrorKey } from './sso-errors';
import { DOMAIN_PATTERN } from './sso-labels';
import { useAddSsoDomain } from './use-sso';

const DOMAIN_ID = 'sso-add-domain';
const FORM_ID = 'sso-add-domain-form';

export interface AddDomainDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  opsApi: OpsAdminApi;
}

/**
 * Adds an email domain to a connection (`POST .../domains`, administration
 * step-up), then shows the DNS TXT record the employer publishes to prove
 * ownership. Mount it with a new `key` per opening so it starts empty.
 */
export function AddDomainDialog({ open, onOpenChange, connectionId, opsApi }: AddDomainDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const add = useAddSsoDomain(opsApi);
  const [domain, setDomain] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [apiError, setApiError] = useState<SsoErrorKey | null>(null);
  const [added, setAdded] = useState<SsoDomainResponse | null>(null);
  const label = t('admin:sso.domains.field');

  const close = () => {
    if (!add.isPending) onOpenChange(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (add.isPending) return;
    const value = domain.trim().toLowerCase();
    setApiError(null);
    if (!DOMAIN_PATTERN.test(value)) {
      setErrors([{ id: DOMAIN_ID, label, message: t('admin:sso.errors.domainInvalid') }]);
      return;
    }
    setErrors([]);
    try {
      setAdded(await add.mutateAsync({ id: connectionId, domain: value }));
    } catch (err) {
      const found = ssoProblem(err, 'addDomain');
      if (found === null) {
        onOpenChange(false);
        return;
      }
      if (found.field === 'domain') setErrors([{ id: DOMAIN_ID, label, message: t(`admin:sso.errors.${found.key}`) }]);
      else setApiError(found.key);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        title={t('admin:sso.domains.addTitle')}
        description={added ? undefined : t('admin:sso.domains.addDescription')}
        closeLabel={t('common:nav.close')}
      >
        {added ? (
          <div className="space-y-4">
            <Alert tone="success" title={t('admin:sso.domains.addedTitle')}>
              {added.domain}
            </Alert>
            <Text>{t('admin:sso.domains.txtIntro')}</Text>
            <dl className="space-y-3">
              <CopyValue label={t('admin:sso.domains.txtName')} value={added.txtRecordName} />
              <CopyValue label={t('admin:sso.domains.txtValue')} value={added.txtRecordValue} />
            </dl>
            <DialogActions>
              <Button onClick={() => onOpenChange(false)}>{t('admin:sso.domains.done')}</Button>
            </DialogActions>
          </div>
        ) : (
          <form id={FORM_ID} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
            <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
            {apiError ? <Alert tone="danger">{t(`admin:sso.errors.${apiError}`)}</Alert> : null}
            <Field id={DOMAIN_ID} label={label} error={errors.find((e) => e.id === DOMAIN_ID)?.message} required>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} autoComplete="off" placeholder="example.com" />
            </Field>
            <DialogActions>
              <Button type="button" variant="secondary" onClick={close} disabled={add.isPending}>
                {t('admin:sso.cancel')}
              </Button>
              <Button type="submit" loading={add.isPending}>
                {t('admin:sso.domains.submit')}
              </Button>
            </DialogActions>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

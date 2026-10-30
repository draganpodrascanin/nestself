import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  FormErrorSummary,
  Input,
  RadioGroup,
  RadioItem,
  Select,
  Switch,
  Text,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import { SSO_SLUG_PATTERN } from '@nestself/contracts';
import type { OrganizationResponse, SsoProtocol } from '@nestself/contracts';
import type { OpsAdminApi, SsoConnectionCreateBody } from '@nestself/api-client';
import { ssoProblem } from './sso-errors';
import type { SsoErrorKey, SsoField } from './sso-errors';
import { isHttpUrl, providerNamePreview } from './sso-labels';
import { useCreateSsoConnection } from './use-sso';

const ID = {
  form: 'sso-create-form',
  orgId: 'sso-create-org',
  slug: 'sso-create-slug',
  protocol: 'sso-create-protocol',
  metadataUrl: 'sso-create-metadata-url',
  metadataXml: 'sso-create-metadata-xml',
  oidcIssuer: 'sso-create-oidc-issuer',
  oidcClientId: 'sso-create-oidc-client-id',
  oidcClientSecret: 'sso-create-oidc-client-secret',
  defaultOrgUnitId: 'sso-create-default-org-unit',
  domain: 'sso-create-domain',
} as const;
type FieldName = Exclude<keyof typeof ID, 'form'>;

type MetadataSource = 'url' | 'xml';

export interface CreateConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opsApi: OpsAdminApi;
  organizations: OrganizationResponse[];
}

/**
 * Creates a DRAFT connection (`POST /ops/sso-connections`, administration
 * step-up). IdP-initiated sign-in is not offered: the API accepts only
 * `false` until the risk-acceptance process exists. The OIDC client secret
 * is write-only: sent once, held by the identity provider, never shown.
 */
export function CreateConnectionDialog({ open, onOpenChange, opsApi, organizations }: CreateConnectionDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const create = useCreateSsoConnection(opsApi);
  const [orgId, setOrgId] = useState('');
  const [slug, setSlug] = useState('');
  const [protocol, setProtocol] = useState<SsoProtocol>('SAML');
  const [source, setSource] = useState<MetadataSource>('url');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [oidcIssuer, setOidcIssuer] = useState('');
  const [oidcClientId, setOidcClientId] = useState('');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [jit, setJit] = useState(false);
  const [defaultOrgUnitId, setDefaultOrgUnitId] = useState('');
  const [errors, setErrors] = useState<FormError[]>([]);
  /** A refused request that names no field: shown above the fields. */
  const [apiError, setApiError] = useState<SsoErrorKey | null>(null);
  const errorFor = (name: FieldName) => errors.find((e) => e.id === ID[name])?.message;

  const labels: Record<FieldName, string> = {
    orgId: t('admin:sso.create.organization'),
    slug: t('admin:sso.create.slug'),
    protocol: t('admin:sso.create.protocol'),
    metadataUrl: t('admin:sso.create.metadataUrl'),
    metadataXml: t('admin:sso.create.metadataXml'),
    oidcIssuer: t('admin:sso.create.oidcIssuer'),
    oidcClientId: t('admin:sso.create.oidcClientId'),
    oidcClientSecret: t('admin:sso.create.oidcClientSecret'),
    defaultOrgUnitId: t('admin:sso.create.defaultOrgUnit'),
    domain: t('admin:sso.domains.field'),
  };
  const problem = (name: FieldName, message: string): FormError => ({ id: ID[name], label: labels[name], message });

  /** Closes and forgets the write-only secret: the dialog stays mounted for its exit animation. */
  const finish = () => {
    setOidcClientSecret('');
    onOpenChange(false);
  };

  const close = () => {
    if (!create.isPending) finish();
  };

  const validate = (): FormError[] => {
    const problems: FormError[] = [];
    if (!orgId) problems.push(problem('orgId', t('admin:sso.errors.organizationRequired')));
    if (!SSO_SLUG_PATTERN.test(slug.trim())) problems.push(problem('slug', t('admin:sso.errors.slugPattern')));
    if (protocol === 'SAML') {
      if (source === 'url' && !isHttpUrl(metadataUrl.trim())) problems.push(problem('metadataUrl', t('admin:sso.errors.urlInvalid')));
      if (source === 'xml' && !metadataXml.trim()) problems.push(problem('metadataXml', t('admin:sso.errors.metadataXmlRequired')));
    } else {
      if (!isHttpUrl(oidcIssuer.trim())) problems.push(problem('oidcIssuer', t('admin:sso.errors.urlInvalid')));
      if (!oidcClientId.trim()) problems.push(problem('oidcClientId', t('admin:sso.errors.clientIdRequired')));
    }
    return problems;
  };

  const body = (): SsoConnectionCreateBody => ({
    orgId,
    slug: slug.trim(),
    protocol,
    ...(protocol === 'SAML' && source === 'url' ? { metadataUrl: metadataUrl.trim() } : {}),
    ...(protocol === 'SAML' && source === 'xml' ? { metadataXml: metadataXml.trim() } : {}),
    ...(protocol === 'OIDC' ? { oidcIssuer: oidcIssuer.trim(), oidcClientId: oidcClientId.trim() } : {}),
    ...(protocol === 'OIDC' && oidcClientSecret ? { oidcClientSecret } : {}),
    jitProvisioning: jit,
    ...(defaultOrgUnitId.trim() ? { defaultOrgUnitId: defaultOrgUnitId.trim() } : {}),
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    const problems = validate();
    setErrors(problems);
    setApiError(null);
    if (problems.length > 0) return;
    try {
      await create.mutateAsync(body());
      // Drop the request (and its secret) from the mutation state.
      create.reset();
      addToast({ title: t('admin:sso.create.success'), tone: 'success' });
      finish();
    } catch (err) {
      const found = ssoProblem(err, 'create');
      if (found === null) {
        finish();
        return;
      }
      const message = t(`admin:sso.errors.${found.key}`);
      const name = fieldName(found.field);
      if (name) setErrors([problem(name, message)]);
      else setApiError(found.key);
    }
  };

  const trimmedSlug = slug.trim();

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent title={t('admin:sso.create.title')} description={t('admin:sso.create.description')} closeLabel={t('common:nav.close')}>
        <form id={ID.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          {apiError ? <Alert tone="danger">{t(`admin:sso.errors.${apiError}`)}</Alert> : null}

          <Field id={ID.orgId} label={labels.orgId} error={errorFor('orgId')} required>
            <Select
              placeholder={t('admin:sso.create.organizationPlaceholder')}
              options={organizations.map((o) => ({ value: o.id, label: o.name }))}
              value={orgId || undefined}
              onValueChange={(value) => setOrgId(value ?? '')}
            />
          </Field>

          <RadioGroup label={labels.protocol} value={protocol} onValueChange={(value) => setProtocol(value as SsoProtocol)}>
            <RadioItem value="SAML">{t('admin:sso.protocols.SAML')}</RadioItem>
            <RadioItem value="OIDC">{t('admin:sso.protocols.OIDC')}</RadioItem>
          </RadioGroup>

          <div className="space-y-1">
            <Field id={ID.slug} label={labels.slug} description={t('admin:sso.create.slugHint')} error={errorFor('slug')} required>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} autoComplete="off" />
            </Field>
            {trimmedSlug ? (
              <Text tone="secondary" typeRole="metadata">
                {t('admin:sso.create.providerPreview', { name: providerNamePreview(trimmedSlug, protocol) })}
              </Text>
            ) : null}
          </div>

          {protocol === 'SAML' ? (
            <>
              <RadioGroup label={t('admin:sso.create.metadataSource')} value={source} onValueChange={(value) => setSource(value as MetadataSource)}>
                <RadioItem value="url">{t('admin:sso.create.metadataSourceUrl')}</RadioItem>
                <RadioItem value="xml">{t('admin:sso.create.metadataSourceXml')}</RadioItem>
              </RadioGroup>
              {source === 'url' ? (
                <Field id={ID.metadataUrl} label={labels.metadataUrl} error={errorFor('metadataUrl')} required>
                  <Input type="url" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} autoComplete="off" />
                </Field>
              ) : (
                <Field id={ID.metadataXml} label={labels.metadataXml} error={errorFor('metadataXml')} required>
                  <Textarea rows={5} value={metadataXml} onChange={(e) => setMetadataXml(e.target.value)} />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field id={ID.oidcIssuer} label={labels.oidcIssuer} error={errorFor('oidcIssuer')} required>
                <Input type="url" value={oidcIssuer} onChange={(e) => setOidcIssuer(e.target.value)} autoComplete="off" />
              </Field>
              <Field id={ID.oidcClientId} label={labels.oidcClientId} error={errorFor('oidcClientId')} required>
                <Input value={oidcClientId} onChange={(e) => setOidcClientId(e.target.value)} autoComplete="off" />
              </Field>
              <Field
                id={ID.oidcClientSecret}
                label={labels.oidcClientSecret}
                description={t('admin:sso.create.secretHint')}
                error={errorFor('oidcClientSecret')}
              >
                <Input type="password" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} autoComplete="off" />
              </Field>
            </>
          )}

          <div className="space-y-2">
            <Switch checked={jit} onCheckedChange={setJit}>
              {t('admin:sso.create.jit')}
            </Switch>
            {jit ? <Alert tone="warning">{t('admin:sso.jitWarning')}</Alert> : null}
          </div>

          <Field
            id={ID.defaultOrgUnitId}
            label={labels.defaultOrgUnitId}
            description={t('admin:sso.create.defaultOrgUnitHint')}
            error={errorFor('defaultOrgUnitId')}
          >
            <Input value={defaultOrgUnitId} onChange={(e) => setDefaultOrgUnitId(e.target.value)} autoComplete="off" />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={create.isPending}>
              {t('admin:sso.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('admin:sso.create.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The form field of a server problem; the domain field does not exist on this form. */
function fieldName(field: SsoField | null): FieldName | null {
  if (field === null || field === 'domain') return null;
  return field;
}

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
  Switch,
  Text,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { SsoConnectionResponse, SsoConnectionUpdateRequest, SsoProtocol } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { ssoProblem } from './sso-errors';
import type { SsoErrorKey, SsoField } from './sso-errors';
import { isHttpsUrl } from './sso-labels';
import { useUpdateSsoConnection } from './use-sso';

const ID = {
  form: 'sso-edit-form',
  protocol: 'sso-edit-protocol',
  metadataUrl: 'sso-edit-metadata-url',
  metadataXml: 'sso-edit-metadata-xml',
  oidcIssuer: 'sso-edit-oidc-issuer',
  oidcClientId: 'sso-edit-oidc-client-id',
  oidcClientSecret: 'sso-edit-oidc-client-secret',
  defaultOrgUnitId: 'sso-edit-default-org-unit',
} as const;
type FieldName = Exclude<keyof typeof ID, 'form'>;

export interface EditConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The connection to edit; mount the dialog with a new `key` per edit so the fields start from it. */
  connection: SsoConnectionResponse;
  opsApi: OpsAdminApi;
}

type FormErrorKey = SsoErrorKey | 'nothingChanged';

/**
 * Edits a connection's metadata, JIT provisioning, default org unit and, for
 * OIDC, the verified-email-claim rule (`PATCH /ops/sso-connections/:id`,
 * administration step-up). Only changed fields are sent. The OIDC client
 * secret field always starts empty: the secret is write-only, an empty field
 * keeps the current one, and a typed one is dropped from the form and the
 * mutation state whatever the outcome.
 *
 * The protocol can change only while the connection is a DRAFT (the API
 * answers 422 `protocol` otherwise); the new protocol's own settings go in
 * the same request.
 *
 * On an ACTIVE or SUSPENDED connection a change to the provider settings
 * (metadata, issuer, client id or secret) takes it to TESTING (SSO-R-01):
 * the dialog warns up front and the success toast says so. The claim rule
 * is NestSelf's own, not a provider setting: changing it needs no re-test.
 */
export function EditConnectionDialog({ open, onOpenChange, connection, opsApi }: EditConnectionDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { add: addToast } = useToast();
  const update = useUpdateSsoConnection(opsApi);
  const [protocol, setProtocol] = useState<SsoProtocol>(connection.protocol);
  const [metadataUrl, setMetadataUrl] = useState(connection.metadataUrl ?? '');
  const [metadataXml, setMetadataXml] = useState('');
  const [oidcIssuer, setOidcIssuer] = useState(connection.oidcIssuer ?? '');
  const [oidcClientId, setOidcClientId] = useState(connection.oidcClientId ?? '');
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [claimRequired, setClaimRequired] = useState(connection.oidcEmailVerifiedClaimRequired);
  const [jit, setJit] = useState(connection.jitProvisioning);
  const [defaultOrgUnitId, setDefaultOrgUnitId] = useState(connection.defaultOrgUnitId ?? '');
  const [errors, setErrors] = useState<FormError[]>([]);
  /** A refused request that names no field of this form, or nothing to send: shown above the fields. */
  const [formError, setFormError] = useState<FormErrorKey | null>(null);
  const errorFor = (name: FieldName) => errors.find((e) => e.id === ID[name])?.message;

  const labels: Record<FieldName, string> = {
    protocol: t('admin:sso.create.protocol'),
    metadataUrl: t('admin:sso.create.metadataUrl'),
    metadataXml: t('admin:sso.create.metadataXml'),
    oidcIssuer: t('admin:sso.create.oidcIssuer'),
    oidcClientId: t('admin:sso.create.oidcClientId'),
    oidcClientSecret: t('admin:sso.edit.secretReplace'),
    defaultOrgUnitId: t('admin:sso.create.defaultOrgUnit'),
  };
  const problem = (name: FieldName, message: string): FormError => ({ id: ID[name], label: labels[name], message });

  /** Closes and forgets the write-only secret: the dialog stays mounted for its exit animation. */
  const finish = () => {
    setOidcClientSecret('');
    onOpenChange(false);
  };

  const close = () => {
    if (!update.isPending) finish();
  };

  const draft = connection.status === 'DRAFT';
  const saml = protocol === 'SAML';

  const changes = (): SsoConnectionUpdateRequest => {
    const patch: SsoConnectionUpdateRequest = {};
    if (protocol !== connection.protocol) patch.protocol = protocol;
    if (saml) {
      const url = metadataUrl.trim();
      if (url !== (connection.metadataUrl ?? '')) patch.metadataUrl = url || null;
      if (metadataXml.trim()) patch.metadataXml = metadataXml.trim();
    } else {
      if (oidcIssuer.trim() !== (connection.oidcIssuer ?? '')) patch.oidcIssuer = oidcIssuer.trim() || null;
      if (oidcClientId.trim() !== (connection.oidcClientId ?? '')) patch.oidcClientId = oidcClientId.trim() || null;
      if (oidcClientSecret) patch.oidcClientSecret = oidcClientSecret;
      if (claimRequired !== connection.oidcEmailVerifiedClaimRequired) patch.oidcEmailVerifiedClaimRequired = claimRequired;
    }
    if (jit !== connection.jitProvisioning) patch.jitProvisioning = jit;
    const unit = defaultOrgUnitId.trim();
    if (unit !== (connection.defaultOrgUnitId ?? '')) patch.defaultOrgUnitId = unit || null;
    return patch;
  };

  const validate = (patch: SsoConnectionUpdateRequest): FormError[] => {
    const problems: FormError[] = [];
    const add = (name: FieldName, message: string) => {
      if (!problems.some((p) => p.id === ID[name])) problems.push(problem(name, message));
    };
    if (patch.metadataUrl && !isHttpsUrl(patch.metadataUrl)) add('metadataUrl', t('admin:sso.errors.urlInvalid'));
    if (patch.oidcIssuer !== undefined && (patch.oidcIssuer === null || !isHttpsUrl(patch.oidcIssuer))) {
      add('oidcIssuer', t('admin:sso.errors.urlInvalid'));
    }
    if (patch.oidcClientId === null) add('oidcClientId', t('admin:sso.errors.clientIdRequired'));
    // A new protocol brings the settings it cannot do without: the draft is not left half-configured.
    if (patch.protocol === 'OIDC') {
      if (!oidcIssuer.trim()) add('oidcIssuer', t('admin:sso.errors.urlInvalid'));
      if (!oidcClientId.trim()) add('oidcClientId', t('admin:sso.errors.clientIdRequired'));
    }
    if (patch.protocol === 'SAML' && !metadataUrl.trim() && !metadataXml.trim()) {
      add('metadataUrl', t('admin:sso.errors.fieldSamlMetadata'));
    }
    return problems;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (update.isPending) return;
    const patch = changes();
    const problems = validate(patch);
    setErrors(problems);
    setFormError(null);
    if (problems.length > 0) return;
    if (Object.keys(patch).length === 0) {
      setFormError('nothingChanged');
      return;
    }
    try {
      const saved = await update.mutateAsync({ id: connection.id, body: patch });
      const backToTesting = (connection.status === 'ACTIVE' || connection.status === 'SUSPENDED') && saved.status === 'TESTING';
      addToast({
        title: t(backToTesting ? 'admin:sso.edit.backToTesting' : 'admin:sso.edit.success'),
        tone: backToTesting ? 'warning' : 'success',
      });
      finish();
    } catch (err) {
      const found = ssoProblem(err, 'update');
      if (found === null) {
        finish();
        return;
      }
      const name = fieldName(found.field);
      if (name) setErrors([problem(name, t(`admin:sso.errors.${found.key}`))]);
      else setFormError(found.key);
    } finally {
      // The request may have carried a new write-only secret: whatever the
      // outcome, neither the mutation state nor the form keeps it.
      update.reset();
      setOidcClientSecret('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent title={t('admin:sso.edit.title')} description={t('admin:sso.edit.description')} closeLabel={t('common:nav.close')}>
        <form id={ID.form} tabIndex={-1} noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          {formError ? <Alert tone="danger">{t(`admin:sso.errors.${formError}`)}</Alert> : null}
          {connection.status === 'ACTIVE' ? <Alert tone="warning">{t('admin:sso.edit.activeWarning')}</Alert> : null}
          {connection.status === 'SUSPENDED' ? <Alert tone="warning">{t('admin:sso.edit.suspendedWarning')}</Alert> : null}

          <div className="space-y-1">
            <RadioGroup label={labels.protocol} value={protocol} onValueChange={(value) => setProtocol(value as SsoProtocol)} disabled={!draft}>
              <RadioItem value="SAML">{t('admin:sso.protocols.SAML')}</RadioItem>
              <RadioItem value="OIDC">{t('admin:sso.protocols.OIDC')}</RadioItem>
            </RadioGroup>
            {draft ? null : (
              <Text tone="secondary" typeRole="metadata">
                {t('admin:sso.edit.protocolLocked')}
              </Text>
            )}
            {errorFor('protocol') ? (
              <Text tone="danger" typeRole="metadata">
                {errorFor('protocol')}
              </Text>
            ) : null}
          </div>

          {saml ? (
            <>
              <Field id={ID.metadataUrl} label={labels.metadataUrl} error={errorFor('metadataUrl')}>
                <Input type="url" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)} autoComplete="off" />
              </Field>
              <Field id={ID.metadataXml} label={labels.metadataXml} description={t('admin:sso.edit.metadataXmlHint')} error={errorFor('metadataXml')}>
                <Textarea rows={4} value={metadataXml} onChange={(e) => setMetadataXml(e.target.value)} />
              </Field>
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
                description={t('admin:sso.edit.secretReplaceHint')}
                error={errorFor('oidcClientSecret')}
              >
                <Input type="password" value={oidcClientSecret} onChange={(e) => setOidcClientSecret(e.target.value)} autoComplete="new-password" />
              </Field>
              <div className="space-y-1">
                <Switch checked={claimRequired} onCheckedChange={setClaimRequired}>
                  {t('admin:sso.create.oidcClaimRequired')}
                </Switch>
                <Text tone="secondary" typeRole="metadata">
                  {t('admin:sso.create.oidcClaimRequiredHint')}
                </Text>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Switch checked={jit} onCheckedChange={setJit}>
              {t('admin:sso.create.jit')}
            </Switch>
            {jit && !connection.jitProvisioning ? <Alert tone="warning">{t('admin:sso.jitWarning')}</Alert> : null}
          </div>

          <Field
            id={ID.defaultOrgUnitId}
            label={labels.defaultOrgUnitId}
            description={t('admin:sso.edit.defaultOrgUnitHint')}
            error={errorFor('defaultOrgUnitId')}
          >
            <Input value={defaultOrgUnitId} onChange={(e) => setDefaultOrgUnitId(e.target.value)} autoComplete="off" />
          </Field>

          <DialogActions>
            <Button type="button" variant="secondary" onClick={close} disabled={update.isPending}>
              {t('admin:sso.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending}>
              {t('admin:sso.edit.submit')}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fields this form has; a problem with any other field (the slug) shows above the form. */
function fieldName(field: SsoField | null): FieldName | null {
  switch (field) {
    case 'protocol':
    case 'metadataUrl':
    case 'metadataXml':
    case 'oidcIssuer':
    case 'oidcClientId':
    case 'oidcClientSecret':
    case 'defaultOrgUnitId':
      return field;
    default:
      return null;
  }
}

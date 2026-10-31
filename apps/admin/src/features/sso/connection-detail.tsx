import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from '@phosphor-icons/react';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Heading,
  IconButton,
  LinkButton,
  Table,
  Td,
  Text,
  Th,
  useToast,
} from '@nestself/ui';
import { formatDate, formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { SsoConnectionResponse } from '@nestself/contracts';
import type { OpsAdminApi } from '@nestself/api-client';
import { AddDomainDialog } from './add-domain-dialog';
import { CopyValue } from './copy-value';
import { EditConnectionDialog } from './edit-connection-dialog';
import { ssoProblem } from './sso-errors';
import type { SsoErrorKey, SsoOperation } from './sso-errors';
import { SSO_STATUS_TONE } from './sso-labels';
import { useActivateSsoConnection, useTestSsoConnection, useUpdateSsoConnection, useVerifySsoDomain } from './use-sso';

export interface ConnectionDetailProps {
  connection: SsoConnectionResponse;
  organizationName: string;
  opsApi: OpsAdminApi;
  /** Sample mode: every action disabled, nothing is called. */
  sampleMode: boolean;
  onClose: () => void;
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="type-metadata text-text-secondary">{term}</dt>
      <dd className="type-body text-text break-words">{children}</dd>
    </div>
  );
}

/**
 * One connection: its settings, the service-provider values the employer's
 * IdP administrator needs, its domains (add, DNS TXT verification) and the
 * lifecycle actions DRAFT → TESTING (test sign-in) → ACTIVE (activate) ⇄
 * SUSPENDED, and TESTING → DRAFT (reset, which deletes the registered
 * provider). The test sign-in mints a single-use link that staff open or copy
 * themselves. The server enforces every transition and `sso.manage`; the
 * buttons offered per status are convenience.
 */
export function ConnectionDetail({ connection, organizationName, opsApi, sampleMode, onClose }: ConnectionDetailProps) {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const test = useTestSsoConnection(opsApi);
  const activate = useActivateSsoConnection(opsApi);
  const update = useUpdateSsoConnection(opsApi);
  const verify = useVerifySsoDomain(opsApi);
  const [actionError, setActionError] = useState<SsoErrorKey | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [domainOpen, setDomainOpen] = useState(false);
  const [domainKey, setDomainKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editKey, setEditKey] = useState(0);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  /**
   * The confirm button is a `Close` part, so an alert dialog asks to close in
   * the same click, before the mutation is pending; this ignores that request
   * so a failure stays visible in the dialog.
   */
  const confirming = useRef(false);

  const { status } = connection;
  const busy = test.isPending || activate.isPending || update.isPending || verify.isPending;
  const disabled = sampleMode || busy;

  /** Runs one action; a failure shows as translated copy, a cancelled step-up shows nothing. */
  const run = async <T,>(op: SsoOperation, action: () => Promise<T>, success: (result: T) => string | null) => {
    setActionError(null);
    try {
      const result = await action();
      const title = success(result);
      if (title) addToast({ title, tone: 'success' });
      return true;
    } catch (err) {
      const found = ssoProblem(err, op);
      if (found) setActionError(found.key);
      return false;
    }
  };

  /**
   * Mints a single-use link and shows it. Staff open it (an anchor without an
   * opener) or copy it themselves: a tab opened from here could be blocked as
   * a popup, and `noopener` would hide whether it opened at all.
   */
  const mintTestLink = () =>
    void run('test', () => test.mutateAsync(connection.id), ({ startUrl: url }) => {
      setStartUrl(url);
      // The single-use URL lives only in the note's state, not in the mutation cache.
      test.reset();
      return t('admin:sso.actions.testStarted');
    });

  const activateNow = () =>
    void run('activate', () => activate.mutateAsync(connection.id), () => {
      setStartUrl(null);
      return t('admin:sso.actions.activated');
    });

  const reactivate = () =>
    void run('update', () => update.mutateAsync({ id: connection.id, body: { status: 'ACTIVE' } }), () =>
      t('admin:sso.actions.reactivated'),
    );

  /** Closes the confirmation only on success; a failure stays visible in the dialog. */
  const confirmSuspend = () => {
    confirming.current = true;
    queueMicrotask(() => {
      confirming.current = false;
    });
    void run('update', () => update.mutateAsync({ id: connection.id, body: { status: 'SUSPENDED' } }), () =>
      t('admin:sso.actions.suspended'),
    ).then((ok) => {
      if (ok) setSuspendOpen(false);
    });
  };

  /** The registered provider is deleted, so a test link minted before no longer fits it. */
  const confirmReset = () => {
    confirming.current = true;
    queueMicrotask(() => {
      confirming.current = false;
    });
    void run('update', () => update.mutateAsync({ id: connection.id, body: { status: 'DRAFT' } }), () => {
      setStartUrl(null);
      return t('admin:sso.actions.resetDone');
    }).then((ok) => {
      if (ok) setResetOpen(false);
    });
  };

  const verifyDomain = (domainId: string) =>
    void run('verifyDomain', () => verify.mutateAsync({ id: connection.id, domainId }), (d) =>
      t('admin:sso.domains.verified', { domain: d.domain }),
    );

  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle align-top';
  const canTest = status === 'DRAFT' || status === 'TESTING';

  // The single-use start URL is kept only while its note can show: another
  // connection remounts this panel (it is keyed by id), and a status that
  // can no longer be tested drops it (state adjusted during render, no effect).
  const [testable, setTestable] = useState(canTest);
  if (testable !== canTest) {
    setTestable(canTest);
    if (!canTest) setStartUrl(null);
  }

  return (
    <section
      data-testid={`sso-detail-${connection.id}`}
      aria-labelledby={`sso-detail-title-${connection.id}`}
      className="space-y-6 rounded-card border border-border-subtle bg-surface p-4 @min-[640px]:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Heading level={2} id={`sso-detail-title-${connection.id}`}>
            {t('admin:sso.detail.title', { provider: connection.cognitoProviderName })}
          </Heading>
          <Badge tone={SSO_STATUS_TONE[status]}>{t(`admin:sso.statuses.${status}`)}</Badge>
        </div>
        <IconButton variant="ghost" label={t('admin:sso.detail.close')} icon={<X aria-hidden="true" />} onClick={onClose} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            setEditKey((k) => k + 1);
            setEditOpen(true);
          }}
        >
          {t('admin:sso.edit.open')}
        </Button>
        {canTest ? (
          <Button size="sm" disabled={disabled} loading={test.isPending} onClick={mintTestLink}>
            {t('admin:sso.actions.test')}
          </Button>
        ) : null}
        {status === 'TESTING' ? (
          <>
            <Button size="sm" disabled={disabled} loading={activate.isPending} onClick={activateNow}>
              {t('admin:sso.actions.activate')}
            </Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setResetOpen(true)}>
              {t('admin:sso.actions.reset')}
            </Button>
          </>
        ) : null}
        {status === 'ACTIVE' ? (
          <Button size="sm" variant="danger" disabled={disabled} onClick={() => setSuspendOpen(true)}>
            {t('admin:sso.actions.suspend')}
          </Button>
        ) : null}
        {status === 'SUSPENDED' ? (
          <Button size="sm" disabled={disabled} loading={update.isPending} onClick={reactivate}>
            {t('admin:sso.actions.reactivate')}
          </Button>
        ) : null}
      </div>

      {actionError && !suspendOpen && !resetOpen ? (
        <Alert tone="danger" title={t('admin:sso.errors.actionTitle')}>
          {t(`admin:sso.errors.${actionError}`)}
        </Alert>
      ) : null}

      {startUrl && canTest ? (
        <Alert tone="info" title={t('admin:sso.actions.testLinkTitle')}>
          <p>{t('admin:sso.actions.testNote')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <LinkButton href={startUrl} target="_blank" rel="noopener noreferrer" size="sm">
              {t('admin:sso.actions.testLink')}
            </LinkButton>
            <span className="type-metadata">{t('admin:sso.actions.testLinkNote')}</span>
          </div>
          <dl className="mt-3">
            <CopyValue label={t('admin:sso.actions.testLinkLabel')} value={startUrl} />
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={disabled} loading={test.isPending} onClick={mintTestLink}>
              {t('admin:sso.actions.newTestLink')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setStartUrl(null)}>
              {t('admin:sso.actions.testDismiss')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <dl className="grid gap-4 @min-[640px]:grid-cols-2">
        <Item term={t('admin:sso.detail.organization')}>{organizationName}</Item>
        <Item term={t('admin:sso.detail.protocol')}>{t(`admin:sso.protocols.${connection.protocol}`)}</Item>
        {connection.protocol === 'SAML' ? (
          <Item term={t('admin:sso.detail.metadataUrl')}>{connection.metadataUrl ?? t('admin:sso.none')}</Item>
        ) : (
          <>
            <Item term={t('admin:sso.detail.oidcIssuer')}>{connection.oidcIssuer ?? t('admin:sso.none')}</Item>
            <Item term={t('admin:sso.detail.oidcClientId')}>{connection.oidcClientId ?? t('admin:sso.none')}</Item>
            <Item term={t('admin:sso.detail.secret')}>{t('admin:sso.detail.secretWriteOnly')}</Item>
          </>
        )}
        <Item term={t('admin:sso.detail.jit')}>
          {connection.jitProvisioning ? t('admin:sso.detail.jitOn') : t('admin:sso.detail.jitOff')}
        </Item>
        <Item term={t('admin:sso.detail.defaultOrgUnit')}>{connection.defaultOrgUnitId ?? t('admin:sso.none')}</Item>
        <Item term={t('admin:sso.detail.lastTested')}>
          {connection.lastTestedAt ? formatDateTime(connection.lastTestedAt, locale) : t('admin:sso.never')}
        </Item>
        <Item term={t('admin:sso.detail.certificate')}>
          {connection.certificateExpiresAt ? formatDate(connection.certificateExpiresAt, locale) : t('admin:sso.notKnown')}
        </Item>
      </dl>

      <div className="space-y-3">
        <Heading level={3}>{t('admin:sso.detail.spTitle')}</Heading>
        {connection.spMetadata ? (
          <dl className="space-y-3">
            <CopyValue label={t('admin:sso.detail.entityId')} value={connection.spMetadata.entityId} />
            <CopyValue label={t('admin:sso.detail.acsUrl')} value={connection.spMetadata.acsUrl} />
          </dl>
        ) : (
          <Text tone="secondary">{t('admin:sso.detail.spMissing')}</Text>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={3}>{t('admin:sso.domains.title')}</Heading>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setDomainKey((k) => k + 1);
              setDomainOpen(true);
            }}
          >
            {t('admin:sso.domains.add')}
          </Button>
        </div>
        {connection.domains.length === 0 ? (
          <Text tone="secondary">{t('admin:sso.domains.empty')}</Text>
        ) : (
          <Table caption={t('admin:sso.domains.title')}>
            <thead>
              <tr>
                <Th className={headerClass}>{t('admin:sso.domains.domain')}</Th>
                <Th className={headerClass}>{t('admin:sso.domains.status')}</Th>
                <Th className={headerClass}>{t('admin:sso.columns.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {connection.domains.map((d) => (
                <tr key={d.id} data-testid={`sso-domain-${d.id}`}>
                  <Td className={cellClass}>
                    <span className="block">{d.domain}</span>
                    {d.verifiedAt ? null : (
                      <dl className="mt-2 space-y-2">
                        <CopyValue label={t('admin:sso.domains.txtName')} value={d.txtRecordName} />
                        <CopyValue label={t('admin:sso.domains.txtValue')} value={d.txtRecordValue} />
                      </dl>
                    )}
                  </Td>
                  <Td className={cellClass}>
                    {d.verifiedAt ? (
                      <Badge tone="success">{t('admin:sso.domains.verifiedAt', { time: formatDate(d.verifiedAt, locale) })}</Badge>
                    ) : (
                      <Badge tone="warning">{t('admin:sso.domains.pending')}</Badge>
                    )}
                  </Td>
                  <Td className={cellClass}>
                    {d.verifiedAt ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={disabled}
                        loading={verify.isPending && verify.variables?.domainId === d.id}
                        onClick={() => verifyDomain(d.id)}
                      >
                        {t('admin:sso.domains.verify')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {!sampleMode ? (
        <>
          <AddDomainDialog
            key={`domain-${domainKey}`}
            open={domainOpen}
            onOpenChange={setDomainOpen}
            connectionId={connection.id}
            opsApi={opsApi}
          />
          <EditConnectionDialog
            key={`edit-${editKey}`}
            open={editOpen}
            onOpenChange={setEditOpen}
            connection={connection}
            opsApi={opsApi}
          />
          <AlertDialog
            open={suspendOpen}
            onOpenChange={(next) => {
              if (next || confirming.current || update.isPending) return;
              setSuspendOpen(false);
              setActionError(null);
            }}
          >
            <AlertDialogContent
              title={t('admin:sso.actions.suspendTitle')}
              description={t('admin:sso.actions.suspendDescription', { provider: connection.cognitoProviderName })}
              confirmLabel={t('admin:sso.actions.suspend')}
              cancelLabel={t('admin:sso.cancel')}
              destructive
              onConfirm={confirmSuspend}
              confirmPending={update.isPending}
            >
              {actionError ? <Alert tone="danger">{t(`admin:sso.errors.${actionError}`)}</Alert> : null}
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog
            open={resetOpen}
            onOpenChange={(next) => {
              if (next || confirming.current || update.isPending) return;
              setResetOpen(false);
              setActionError(null);
            }}
          >
            <AlertDialogContent
              title={t('admin:sso.actions.resetTitle')}
              description={t('admin:sso.actions.resetConfirm', { provider: connection.cognitoProviderName })}
              confirmLabel={t('admin:sso.actions.reset')}
              cancelLabel={t('admin:sso.cancel')}
              destructive
              onConfirm={confirmReset}
              confirmPending={update.isPending}
            >
              {actionError ? <Alert tone="danger">{t(`admin:sso.errors.${actionError}`)}</Alert> : null}
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </section>
  );
}

/**
 * Signed-in sessions (`GET /auth/sessions`) with a per-row end action and
 * "Sign out everywhere".
 *
 * The API refuses to end the current session through
 * `DELETE /auth/sessions/:id`, so the current row signs out instead: the
 * session ends, the cache is cleared and the user lands on `/sign-in`
 * (Review Focus 3). "Sign out everywhere" ends the other sessions with
 * `POST /auth/sign-out-all` and then this one the same way.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Heading,
  Table,
  Td,
  Text,
  Th,
  useToast,
} from '@nestself/ui';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { SessionListItem } from '@nestself/contracts';
import { accountErrorKey } from './account-errors';
import type { AccountErrorKey } from './account-errors';
import type { AccountApi } from './use-account';
import {
  useRevokeSession,
  useSessions,
  useSignOutAndLeave,
  useSignOutEverywhere,
} from './use-account';

export interface SessionsListProps {
  authApi: AccountApi;
  /** Sample mode: there are no sessions to list, and nothing is called. */
  sampleMode: boolean;
}

export function SessionsList({ authApi, sampleMode }: SessionsListProps) {
  const { t, i18n } = useTranslation(['auth', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { add: addToast } = useToast();
  const sessionsQuery = useSessions(authApi, !sampleMode);
  const revoke = useRevokeSession(authApi);
  const signOutEverywhere = useSignOutEverywhere(authApi);
  const leave = useSignOutAndLeave();

  const [target, setTarget] = useState<SessionListItem | null>(null);
  const [everywhereOpen, setEverywhereOpen] = useState(false);
  const [actionError, setActionError] = useState<AccountErrorKey | null>(null);
  const [leaving, setLeaving] = useState(false);

  const deviceOf = (s: SessionListItem) => s.userAgentFamily || t('auth:account.sessions.columns.device');
  const surfaceOf = (s: SessionListItem) => t(`auth:account.sessions.surface.${s.surface}`);
  const when = (iso: string) => formatDateTime(iso, locale);

  const confirmEnd = async () => {
    const session = target;
    setTarget(null);
    if (!session) return;
    setActionError(null);
    if (session.isCurrent) {
      setLeaving(true);
      await leave();
      return;
    }
    try {
      await revoke.mutateAsync(session.sessionId);
      addToast({ title: t('auth:account.sessions.ended'), tone: 'success' });
    } catch (err) {
      setActionError(accountErrorKey(err));
    }
  };

  const confirmEverywhere = async () => {
    setEverywhereOpen(false);
    setActionError(null);
    try {
      setLeaving(true);
      await signOutEverywhere.mutateAsync();
    } catch (err) {
      setLeaving(false);
      setActionError(accountErrorKey(err));
    }
  };

  const header = (
    <div className="space-y-2">
      <Heading level={3}>{t('auth:account.sessions.title')}</Heading>
      <Text tone="secondary">{t('auth:account.sessions.lead')}</Text>
    </div>
  );

  if (sampleMode) {
    return (
      <div className="space-y-4">
        {header}
        <Alert tone="info">{t('auth:account.sessions.sampleNote')}</Alert>
      </div>
    );
  }

  const sessions = sessionsQuery.data;
  const headerClass = 'bg-tint border-b border-border-subtle';
  const cellClass = 'border-b border-border-subtle';
  const busy = leaving || revoke.isPending || signOutEverywhere.isPending;

  return (
    <div className="space-y-4">
      {header}

      {actionError ? <Alert tone="danger">{t(actionError)}</Alert> : null}

      {sessionsQuery.isError ? (
        <Alert tone="danger" title={t('auth:account.sessions.loadError')}>
          {t(accountErrorKey(sessionsQuery.error))}
        </Alert>
      ) : sessions === undefined ? (
        <Text tone="secondary">{t('auth:account.sessions.loading')}</Text>
      ) : sessions.length === 0 ? (
        <Text tone="secondary">{t('auth:account.sessions.empty')}</Text>
      ) : (
        <Table caption={t('auth:account.sessions.caption')}>
          <thead>
            <tr>
              <Th className={headerClass}>{t('auth:account.sessions.columns.device')}</Th>
              <Th className={headerClass}>{t('auth:account.sessions.columns.app')}</Th>
              <Th className={headerClass}>{t('auth:account.sessions.columns.signedIn')}</Th>
              <Th className={headerClass}>{t('auth:account.sessions.columns.lastActive')}</Th>
              <Th className={headerClass}>{t('auth:account.sessions.columns.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.sessionId}>
                <Td className={cellClass}>
                  <span className="flex flex-wrap items-center gap-2">
                    {deviceOf(s)}
                    {s.isCurrent ? <Badge tone="success">{t('auth:account.sessions.current')}</Badge> : null}
                  </span>
                </Td>
                <Td className={cellClass}>{surfaceOf(s)}</Td>
                <Td className={cellClass}>{when(s.createdAt)}</Td>
                <Td className={cellClass}>{when(s.lastActivityAt)}</Td>
                <Td className={cellClass}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    aria-label={
                      s.isCurrent
                        ? t('auth:account.sessions.signOutHereFor')
                        : t('auth:account.sessions.endFor', { device: deviceOf(s), date: when(s.lastActivityAt) })
                    }
                    onClick={() => setTarget(s)}
                  >
                    {s.isCurrent ? t('auth:account.sessions.signOutHere') : t('auth:account.sessions.end')}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <div>
        <Button variant="secondary" disabled={busy} onClick={() => setEverywhereOpen(true)}>
          {t('auth:account.sessions.everywhere')}
        </Button>
      </div>

      <AlertDialog open={target !== null} onOpenChange={(open) => (open ? undefined : setTarget(null))}>
        <AlertDialogContent
          title={
            target?.isCurrent ? t('auth:account.sessions.currentTitle') : t('auth:account.sessions.endTitle')
          }
          description={
            target?.isCurrent
              ? t('auth:account.sessions.currentBody')
              : t('auth:account.sessions.endBody', { device: target ? deviceOf(target) : '' })
          }
          confirmLabel={
            target?.isCurrent ? t('auth:account.sessions.currentConfirm') : t('auth:account.sessions.endConfirm')
          }
          cancelLabel={t('auth:account.sessions.cancel')}
          destructive
          onConfirm={() => void confirmEnd()}
        />
      </AlertDialog>

      <AlertDialog open={everywhereOpen} onOpenChange={setEverywhereOpen}>
        <AlertDialogContent
          title={t('auth:account.sessions.everywhereTitle')}
          description={t('auth:account.sessions.everywhereBody')}
          confirmLabel={t('auth:account.sessions.everywhereConfirm')}
          cancelLabel={t('auth:account.sessions.cancel')}
          destructive
          onConfirm={() => void confirmEverywhere()}
        />
      </AlertDialog>
    </div>
  );
}

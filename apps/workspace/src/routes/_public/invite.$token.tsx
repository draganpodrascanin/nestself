/**
 * /invite/:token route -- invitation preview and accept.
 *
 * 1. Calls `GET /invitations/:token/preview` to show organisation name.
 * 2. On accept, calls `POST /invitations/accept` and continues into the
 *    returned method/step.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createAuthApi, ApiError } from '@nestself/api-client';
import { Button, Heading, Text, StatusBlock } from '@nestself/ui';
import { useAuth } from '../../auth';
import { api } from '../../api';

export const Route = createFileRoute('/_public/invite/$token')({
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { refreshPrincipal } = useAuth();
  const authApi = useMemo(() => createAuthApi(api), []);

  const [orgName, setOrgName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const preview = await authApi.invitationPreview(token);
        if (!cancelled) setOrgName(preview.organizationName);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && (err.code === 'not_found' || err.status === 404)) {
            setError(t('invite.expired'));
          } else {
            setError(t('error.unknown'));
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authApi, token, t]);

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    try {
      const result = await authApi.invitationAccept(token);

      // The response includes the auth method and optional next step
      if (result.method === 'sso' && result.ssoStartUrl) {
        window.location.assign(result.ssoStartUrl);
        return;
      }

      // For email_otp or password methods, navigate to sign-in
      // The user will need to authenticate to complete the invitation
      await refreshPrincipal();
      void navigate({ to: '/' });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(t('error.unknown'));
      }
    } finally {
      setAccepting(false);
    }
  }, [authApi, token, refreshPrincipal, navigate, t]);

  if (error) {
    return (
      <StatusBlock
        state="expired"
        title={t('invite.expired')}
        body={error}
      />
    );
  }

  if (!orgName) {
    return (
      <Text className="text-center text-text-secondary">
        {t('a11y.loading')}
      </Text>
    );
  }

  return (
    <div className="space-y-6 text-center">
      <Heading level={1} typeRole="screenTitle">
        {t('invite.title')}
      </Heading>

      <div className="rounded-card border border-border-subtle bg-surface p-6">
        <Text className="type-metadata text-text-secondary">
          {t('invite.orgLabel')}
        </Text>
        <Text className="mt-1 font-[var(--font-weight-label)] text-lg">
          {orgName}
        </Text>
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleAccept}
        disabled={accepting}
      >
        {accepting ? t('a11y.loading') : t('invite.accept')}
      </Button>
    </div>
  );
}

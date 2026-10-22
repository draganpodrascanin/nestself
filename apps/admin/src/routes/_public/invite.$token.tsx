/**
 * Invitation acceptance route.
 * Previews the invitation, then accepts it and feeds into the sign-in flow.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Heading, Text, StatusBlock } from '@nestself/ui';
import { createAuthApi, ApiError } from '@nestself/api-client';
import { api } from '../../api';

export const Route = createFileRoute('/_public/invite/$token')({
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const authApi = useMemo(() => createAuthApi(api), []);

  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const preview = await authApi.invitationPreview(token);
        if (!cancelled) {
          setOrgName(preview.organizationName);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setExpired(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authApi, token]);

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    try {
      await authApi.invitationAccept(token);
      void navigate({ to: '/sign-in' });
    } catch (err) {
      if (err instanceof ApiError) {
        setExpired(true);
      }
      setAccepting(false);
    }
  }, [authApi, token, navigate]);

  if (loading) {
    return (
      <div className="text-center">
        <Text className="text-text-secondary">{t('common:state.loading')}</Text>
      </div>
    );
  }

  if (expired) {
    return (
      <StatusBlock
        state="expired"
        title={t('auth:invite.expired')}
        body=""
      />
    );
  }

  return (
    <div className="space-y-6 text-center">
      <Heading level={1} typeRole="screenTitle">
        {t('auth:invite.title')}
      </Heading>

      <div className="rounded-control border border-border-subtle bg-surface p-6">
        <Text className="type-metadata text-text-secondary mb-1">
          {t('auth:invite.orgLabel')}
        </Text>
        <Text className="font-[var(--font-weight-label)]">{orgName}</Text>
      </div>

      <Button
        variant="primary"
        onClick={handleAccept}
        disabled={accepting}
        className="w-full"
      >
        {accepting ? t('auth:a11y.loading') : t('auth:invite.accept')}
      </Button>
    </div>
  );
}

/**
 * The `errorComponent` of the `_authenticated` route.
 *
 * When `GET /auth/me` fails for a reason other than 401 (see
 * `SessionUnavailableError`) the user may well be signed in, so the route shows
 * this instead of the shell: neither a redirect to /sign-in nor an empty
 * screen. Any other error is the router's own error screen to show.
 */
import { useState } from 'react';
import { ErrorComponent } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { useAuth } from './auth-context';
import { SessionUnavailableError } from './route-auth';

export function AuthenticatedErrorComponent({ error }: ErrorComponentProps) {
  if (!(error instanceof SessionUnavailableError)) return <ErrorComponent error={error} />;
  return <SessionUnavailable />;
}

/**
 * "Try again" asks the provider for the session. The provider owns the
 * session, and the router sync in `__root.tsx` hands whatever it finds to the
 * guards, which then open the page, or send the user to /sign-in when the
 * answer is 401. (`router.invalidate()` alone would let the guards read the
 * session while the shell, which reads the provider, still had none.) While
 * the answer is awaited the block shows that it is loading, so a retry that
 * fails again is not mistaken for a button that does nothing.
 */
function SessionUnavailable() {
  const { t } = useTranslation('common');
  const { refreshPrincipal } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    setRetrying(true);
    void refreshPrincipal().finally(() => setRetrying(false));
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center p-4">
      {retrying ? (
        <StatusBlock state="loading" title={t('state.loading')} body="" className="w-full max-w-md" />
      ) : (
        <StatusBlock
          state="offline"
          title={t('state.sessionUnavailable.title')}
          body={t('state.sessionUnavailable.body')}
          action={{ label: t('action.retry'), onClick: retry }}
          className="w-full max-w-md"
        />
      )}
    </main>
  );
}

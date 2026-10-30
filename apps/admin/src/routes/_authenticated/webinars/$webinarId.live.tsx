/**
 * The presenter view and moderator console route (WBN-16 to WBN-29,
 * guidelines 12.2): `event.present` or `event.moderate`; the server decides
 * who hosts this occurrence and answers 404 to anyone else. The router
 * plugin splits the route into its own chunk and the call controller loads
 * `amazon-chime-sdk-js` on demand (CW-R-98).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { useAuth } from '../../../auth';
import { canHostWebinars, requireWebinarHost } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useHostView } from '../../../webinars/use-webinars';
import { WebinarConsole } from '../../../webinars/webinar-console';

export const Route = createFileRoute('/_authenticated/webinars/$webinarId/live')({
  beforeLoad: ({ context }) => requireWebinarHost(context.auth),
  component: WebinarConsoleRoute,
});

function WebinarConsoleRoute() {
  const { webinarId } = Route.useParams();
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const { status, webinar, error, refetch } = useHostView(webinarId);

  if (!canHostWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  if (status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;
  const notFound = status === 'success' ? !webinar : error instanceof ApiError && error.status === 404;
  if (notFound || !webinar) {
    return notFound ? (
      <StatusBlock state="permission" title={t('calls:webinar.admin.notFoundTitle')} body={t('calls:errors.notFound')} />
    ) : (
      <StatusBlock
        state="offline"
        title={t('calls:webinar.detail.errorTitle')}
        body={mapWebinarError(error, tCalls)}
        action={{ label: t('common:action.retry'), onClick: refetch }}
      />
    );
  }
  return <WebinarConsole key={webinar.id} webinar={webinar} />;
}

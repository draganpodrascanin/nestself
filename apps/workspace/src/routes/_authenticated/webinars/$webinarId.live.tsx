/**
 * The attendee's live webinar route (WBN-06, WBN-07, guidelines 12.1). The
 * router plugin splits the route into its own chunk (`autoCodeSplitting`)
 * and the call controller loads `amazon-chime-sdk-js` on demand, so neither
 * the video client nor the SDK is in the main bundle (CW-R-98).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { useAuth } from '../../../auth';
import { canAttendWebinars, requireWebinarAccess } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useWebinar } from '../../../webinars/use-webinars';
import { WebinarLive } from '../../../webinars/webinar-live';

export const Route = createFileRoute('/_authenticated/webinars/$webinarId/live')({
  beforeLoad: ({ context, location }) => requireWebinarAccess(context.auth, location.pathname),
  component: WebinarLiveRoute,
});

function WebinarLiveRoute() {
  const { webinarId } = Route.useParams();
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const { status, webinar, error, refetch } = useWebinar(webinarId);

  if (!canAttendWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  if (status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;

  const notFound = status === 'success' ? !webinar : error instanceof ApiError && error.status === 404;
  if (notFound || !webinar) {
    return (
      <div className="space-y-6">
        <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
          {t('calls:webinar.detail.back')}
        </Link>
        {notFound ? (
          <StatusBlock state="permission" title={t('calls:webinar.detail.notFoundTitle')} body={t('calls:errors.notFound')} />
        ) : (
          <StatusBlock
            state="offline"
            title={t('calls:webinar.detail.errorTitle')}
            body={mapWebinarError(error, tCalls)}
            action={{ label: t('common:action.retry'), onClick: refetch }}
          />
        )}
      </div>
    );
  }

  return <WebinarLive key={webinar.id} webinar={webinar} />;
}

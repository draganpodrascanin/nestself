/**
 * Edit an occurrence (WBN-30): the occurrence form prefilled, saved with
 * `PATCH /ops/webinars/:id` while `draft` or `published`; the audience (and
 * with it the organisation) only while a draft. A refused edit answers 409
 * `not_editable`, shown as translated copy. `event.manage` only; the server
 * decides.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Heading, StatusBlock, useToast } from '@nestself/ui';
import { ApiError, webinarKeys } from '@nestself/api-client';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { canManageWebinars, requireWebinarManage } from '../../../webinars/route-gate';
import { mapWebinarError } from '../../../webinars/map-webinar-error';
import { useOccurrence } from '../../../webinars/use-webinars';
import { useLocalized } from '../../../webinars/webinar-format';
import { WebinarForm } from '../../../webinars/webinar-form';

export const Route = createFileRoute('/_authenticated/webinars/$webinarId/edit')({
  beforeLoad: ({ context }) => requireWebinarManage(context.auth),
  component: EditWebinarPage,
});

function EditWebinarPage() {
  const { webinarId } = Route.useParams();
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const localized = useLocalized();
  const { status, webinar, error, refetch } = useOccurrence(webinarId);

  if (!canManageWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }
  if (status === 'pending') return <StatusBlock state="loading" title={t('common:state.loading')} body="" />;

  const back = (
    <Link to="/webinars/$webinarId" params={{ webinarId }} className="type-body text-primary underline underline-offset-[0.2em]">
      {t('calls:webinar.console.backToWebinar')}
    </Link>
  );
  const notFound = status === 'success' ? !webinar : error instanceof ApiError && error.status === 404;
  if (notFound || !webinar) {
    return (
      <div className="space-y-6">
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('calls:webinar.admin.notFoundTitle')} body={t('calls:errors.notFound')} />
        ) : (
          <StatusBlock
            state="offline"
            title={t('calls:webinar.admin.errorTitle')}
            body={mapWebinarError(error, tCalls)}
            action={{ label: t('common:action.retry'), onClick: refetch }}
          />
        )}
      </div>
    );
  }

  const editable = webinar.status === 'draft' || webinar.status === 'published';

  return (
    <div className="space-y-6">
      {back}
      <Heading level={1} typeRole="screenTitle">
        {t('calls:webinar.form.editTitle')}
      </Heading>
      <p className="type-body text-text-secondary">{localized(webinar.title)}</p>
      {isSampleDataMode ? <Alert tone="info">{t('calls:webinar.admin.sampleNotice')}</Alert> : null}
      {editable ? (
        <WebinarForm
          webinar={webinar}
          onSaved={(saved) => {
            void queryClient.invalidateQueries({ queryKey: webinarKeys.all });
            toast.add({ title: t('calls:webinar.admin.saved'), tone: 'success' });
            void navigate({ to: '/webinars/$webinarId', params: { webinarId: saved.id } });
          }}
        />
      ) : (
        <Alert tone="warning">{t('calls:errors.notEditable')}</Alert>
      )}
    </div>
  );
}

/**
 * New webinar occurrence (WBN-30): the form, then the new draft's page,
 * where it can be published (WBN-31). `event.manage` only; the server
 * decides.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Heading, StatusBlock } from '@nestself/ui';
import { webinarKeys } from '@nestself/api-client';
import { useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { canManageWebinars, requireWebinarManage } from '../../../webinars/route-gate';
import { WebinarForm } from '../../../webinars/webinar-form';

export const Route = createFileRoute('/_authenticated/webinars/new')({
  beforeLoad: ({ context }) => requireWebinarManage(context.auth),
  component: NewWebinarPage,
});

function NewWebinarPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { principal, effectiveActions } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  if (!canManageWebinars(principal, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  return (
    <div className="space-y-6">
      <Link to="/webinars" className="type-body text-primary underline underline-offset-[0.2em]">
        {t('calls:webinar.admin.back')}
      </Link>
      <Heading level={1} typeRole="screenTitle">
        {t('calls:webinar.form.title')}
      </Heading>
      {isSampleDataMode ? <Alert tone="info">{t('calls:webinar.admin.sampleNotice')}</Alert> : null}
      <WebinarForm
        onCreated={(webinar) => {
          void queryClient.invalidateQueries({ queryKey: webinarKeys.ops() });
          void navigate({ to: '/webinars/$webinarId', params: { webinarId: webinar.id }, search: { created: true } });
        }}
      />
    </div>
  );
}

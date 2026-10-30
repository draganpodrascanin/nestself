/**
 * The consultation call route (D-CW-24, guidelines 12.1): outside the
 * `_authenticated` layout, so the call fills the screen and the mobile app's
 * in-app browser can open it (the ticket exchange arrives with T-CW-4.1;
 * today the session cookie authenticates it). The route component is split
 * into its own chunk by the router plugin (`autoCodeSplitting`), and the
 * controller loads `amazon-chime-sdk-js` on demand, so neither the video
 * client nor the SDK is in the main bundle (CW-R-98).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { StatusBlock } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { ConsultationCall } from '../../calls/consultation-call';
import { mapCallError } from '../../calls/map-call-error';
import { canJoinConsultations, requireConsultationAccess } from '../../calls/route-gate';
import { useExpertLabel } from '../../calls/appointment-parts';
import { useAppointment } from '../../calls/use-appointments';

export const Route = createFileRoute('/call/$appointmentId')({
  beforeLoad: ({ context, location }) => requireConsultationAccess(context.auth, location.pathname),
  component: CallRoute,
});

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="gap-6 px-4 py-6 sm:px-6 mx-auto flex w-full max-w-4xl flex-col">
      {children}
    </main>
  );
}

function CallRoute() {
  const { appointmentId } = Route.useParams();
  const { t } = useTranslation('calls');
  const { t: tCommon } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  const { status, appointment, error, refetch } = useAppointment(appointmentId);
  const expertLabel = useExpertLabel();

  const permission = <StatusBlock state="permission" title={tCommon('state.permission.title')} body={tCommon('state.permission.body')} />;
  if (!canJoinConsultations(principal, effectiveActions)) return <Frame>{permission}</Frame>;
  if (status === 'pending') {
    return (
      <Frame>
        <StatusBlock state="loading" title={tCommon('state.loading')} body="" />
      </Frame>
    );
  }

  const back = (
    <Link to="/appointments" className="type-body text-primary underline underline-offset-[0.2em]">
      {t('appointments.back')}
    </Link>
  );
  const notFound = status === 'success' ? !appointment : error instanceof ApiError && error.status === 404;
  if (notFound || !appointment) {
    return (
      <Frame>
        {back}
        {notFound ? (
          <StatusBlock state="permission" title={t('appointments.notFoundTitle')} body={t('appointments.notFoundBody')} />
        ) : (
          <StatusBlock state="offline" title={t('appointments.errorTitle')} body={mapCallError(error, t)} action={{ label: tCommon('action.retry'), onClick: refetch }} />
        )}
      </Frame>
    );
  }

  // The expert joins from the admin app, where the outcome and follow-up live (D-CW-37).
  if (principal?.userId !== appointment.employeeUserId) return <Frame>{permission}</Frame>;

  return <ConsultationCall appointment={appointment} expertName={expertLabel(appointment).name} />;
}

import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@nestself/contracts';
import { resolveRouteAuth } from '../../../../auth';
import { isSampleDataMode } from '../../../../data-source';
import { CyclesScreen } from '../../../../features/listening/cycles-screen';
import { listeningApi } from '../../../../features/listening/listening-api';

/** Survey cycles: `listening.cycles.manage` (the survey administrator). */
export const Route = createFileRoute('/_authenticated/_listening/listening/surveys')({
  beforeLoad: async ({ context }) => {
    if (isSampleDataMode) return;
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal || !can(principal, 'listening.cycles.manage', undefined, effectiveActions)) {
      throw redirect({ to: '/listening' });
    }
  },
  component: () => <CyclesScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});

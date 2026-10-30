import { createFileRoute } from '@tanstack/react-router';
import { PeopleScreen } from '../../../../features/people/people-screen';
import { orgAdminApi } from '../../../../features/access/use-org-admin';
import { isSampleDataMode } from '../../../../data-source';

// Under the `_hr` gate (`program.overview`), which is also the member list's action.
export const Route = createFileRoute('/_authenticated/_hr/hr/people')({
  component: PeoplePage,
});

function PeoplePage() {
  return <PeopleScreen adminApi={orgAdminApi} sampleMode={isSampleDataMode} />;
}

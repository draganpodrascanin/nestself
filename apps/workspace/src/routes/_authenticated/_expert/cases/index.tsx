import { createFileRoute } from '@tanstack/react-router';
import { AssignedCasesScreen } from '../../../../features/cases/conversation-list-screen';
import { professionalApi } from '../../../../features/cases/use-cases';
import { isSampleDataMode } from '../../../../data-source';

// Under the `_expert` gate.
export const Route = createFileRoute('/_authenticated/_expert/cases/')({
  component: CasesPage,
});

function CasesPage() {
  return <AssignedCasesScreen pro={professionalApi} sampleMode={isSampleDataMode} />;
}

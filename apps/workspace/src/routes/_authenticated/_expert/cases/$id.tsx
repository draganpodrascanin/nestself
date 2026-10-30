import { createFileRoute } from '@tanstack/react-router';
import { ExpertConversationScreen } from '../../../../features/cases/conversation-screen';
import { professionalApi } from '../../../../features/cases/use-cases';
import { isSampleDataMode } from '../../../../data-source';

// Under the `_expert` gate; the API authorizes the conversation itself.
export const Route = createFileRoute('/_authenticated/_expert/cases/$id')({
  component: CasePage,
});

function CasePage() {
  const { id } = Route.useParams();
  // Keyed by id: a different conversation starts with a fresh intake form.
  return <ExpertConversationScreen key={id} pro={professionalApi} conversationId={id} sampleMode={isSampleDataMode} />;
}

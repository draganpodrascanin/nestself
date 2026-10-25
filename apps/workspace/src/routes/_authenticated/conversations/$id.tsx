import { createFileRoute } from '@tanstack/react-router';
import { MyConversationScreen } from '../../../features/cases/conversation-screen';
import { professionalApi } from '../../../features/cases/use-cases';
import { isSampleDataMode } from '../../../data-source';

export const Route = createFileRoute('/_authenticated/conversations/$id')({
  component: ConversationPage,
});

function ConversationPage() {
  const { id } = Route.useParams();
  return <MyConversationScreen key={id} pro={professionalApi} conversationId={id} sampleMode={isSampleDataMode} />;
}

import { createFileRoute } from '@tanstack/react-router';
import { MyConversationsScreen } from '../../../features/cases/conversation-list-screen';
import { professionalApi } from '../../../features/cases/use-cases';
import { isSampleDataMode } from '../../../data-source';

export const Route = createFileRoute('/_authenticated/conversations/')({
  component: ConversationsPage,
});

function ConversationsPage() {
  return <MyConversationsScreen pro={professionalApi} sampleMode={isSampleDataMode} />;
}

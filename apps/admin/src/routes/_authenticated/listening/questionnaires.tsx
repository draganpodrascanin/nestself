import { createFileRoute } from '@tanstack/react-router';
import { listeningApi } from '../../../features/listening/listening-api';
import { ListeningGate } from '../../../features/listening/listening-gate';
import { QuestionnairesScreen } from '../../../features/listening/questionnaires-screen';
import { isSampleDataMode } from '../../../data-source';

function QuestionnairesPage() {
  return (
    <ListeningGate action="listening.templates.write">
      <QuestionnairesScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />
    </ListeningGate>
  );
}

export const Route = createFileRoute('/_authenticated/listening/questionnaires')({
  component: QuestionnairesPage,
});

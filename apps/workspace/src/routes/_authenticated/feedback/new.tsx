import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../data-source';
import { FeedbackComposerScreen } from '../../../features/feedback/feedback-composer-screen';
import { listeningApi } from '../../../features/listening/listening-api';

/** The feedback composer (spec FBK-01). Opening it creates nothing; one send creates one case. */
export const Route = createFileRoute('/_authenticated/feedback/new')({
  component: () => <FeedbackComposerScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});

import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../data-source';
import { MyFeedbackScreen } from '../../../features/feedback/my-feedback-screen';
import { listeningApi } from '../../../features/listening/listening-api';

/** The reporter's own feedback cases (spec FBK-02); the API answers only the caller's cases. */
export const Route = createFileRoute('/_authenticated/feedback/')({
  component: () => <MyFeedbackScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});

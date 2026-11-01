import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../../data-source';
import { listeningApi } from '../../../../../features/listening/listening-api';
import { ReviewsScreen } from '../../../../../features/reviews/reviews-screen';

/** Requests and engagements of the organization (spec REV-02, REV-10). */
export const Route = createFileRoute('/_authenticated/_listening/listening/reviews/')({
  component: () => <ReviewsScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});

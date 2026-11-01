import { createFileRoute } from '@tanstack/react-router';
import { isSampleDataMode } from '../../../../../data-source';
import { listeningApi } from '../../../../../features/listening/listening-api';
import { RequestReviewScreen } from '../../../../../features/reviews/request-review-screen';

/** The review request form (spec REV-02). Opening it creates nothing; one send creates one request. */
export const Route = createFileRoute('/_authenticated/_listening/listening/reviews/new')({
  component: () => <RequestReviewScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} />,
});

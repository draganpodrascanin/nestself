import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';
import { isListeningDimensionKey } from '@nestself/contracts';
import type { ListeningDimensionKey } from '@nestself/contracts';
import { isSampleDataMode } from '../../../../data-source';
import { DimensionDetailScreen } from '../../../../features/listening/dimension-detail-screen';
import { listeningApi } from '../../../../features/listening/listening-api';

const searchSchema = z.object({ snapshotId: z.string().min(1).optional() });

export const Route = createFileRoute('/_authenticated/_listening/listening/dimensions/$key')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!isListeningDimensionKey(params.key)) throw notFound();
  },
  component: DimensionPage,
});

function DimensionPage() {
  const { key } = Route.useParams();
  const { snapshotId } = Route.useSearch();
  return <DimensionDetailScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} dimensionKey={key as ListeningDimensionKey} snapshotId={snapshotId} />;
}

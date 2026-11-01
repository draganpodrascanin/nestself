import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { isSampleDataMode } from '../../../../data-source';
import { HeatmapScreen } from '../../../../features/listening/heatmap-screen';
import { listeningApi } from '../../../../features/listening/listening-api';

const searchSchema = z.object({ snapshotId: z.string().min(1).optional() });

export const Route = createFileRoute('/_authenticated/_listening/listening/heatmap')({
  validateSearch: searchSchema,
  component: HeatmapPage,
});

function HeatmapPage() {
  const { snapshotId } = Route.useSearch();
  return <HeatmapScreen listeningApi={listeningApi} sampleMode={isSampleDataMode} snapshotId={snapshotId} />;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_PRINCIPALS, SAMPLE_REVIEW_ENGAGEMENT, SAMPLE_REVIEW_ENGAGEMENT_ID, SAMPLE_REVIEW_REPORT, SAMPLE_SNAPSHOT_CURRENT_ID } from '@nestself/sample-data';
import { apiError, makeAuth, makeListeningApi, renderListeningOps, t } from '../listening/listening-ops-test-harness';
import { EngagementWorkspaceScreen, sectionsOf } from './engagement-workspace-screen';
import { EngagementsScreen } from './engagements-screen';

// The real editor pulls Tiptap and ProseMirror into jsdom; the screen's contract is what it passes in.
vi.mock('@nestself/content/editor', () => ({
  ContentEditor: ({ placeholder, editable }: { placeholder?: string; editable?: boolean }) => (
    <div data-testid="content-editor" role="textbox" aria-label={placeholder} aria-readonly={editable === false || undefined}>
      {placeholder}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Milica: the sample expert, also a qualified workplace reviewer, in the expert context. */
const expertAuth = (actions = [...SAMPLE_PRINCIPALS.expert.effectiveActions]) => makeAuth({ principal: SAMPLE_PRINCIPALS.expert.principal, effectiveActions: actions });

const screenFor = (id: string) => (api: Parameters<typeof EngagementWorkspaceScreen>[0]['listeningApi'], sample: boolean) => (
  <EngagementWorkspaceScreen listeningApi={api} sampleMode={sample} engagementId={id} />
);

describe('sectionsOf', () => {
  it('keeps document sections and drops anything else', () => {
    expect(Object.keys(sectionsOf(SAMPLE_REVIEW_REPORT))).toHaveLength(5);
    expect(sectionsOf(null)).toEqual({});
    expect(sectionsOf({ ...SAMPLE_REVIEW_REPORT, sections: { ...SAMPLE_REVIEW_REPORT.sections, findings: 'plain text' } })).not.toHaveProperty('findings');
  });
});

describe('EngagementsScreen', () => {
  it('lists the reviewer’s engagements with a link to each', async () => {
    renderListeningOps((api, sample) => <EngagementsScreen listeningApi={api} sampleMode={sample} />, { auth: expertAuth() });
    expect(await screen.findByRole('link', { name: SAMPLE_REVIEW_ENGAGEMENT.scope.title })).toHaveAttribute('href', `/reviews/engagements/${SAMPLE_REVIEW_ENGAGEMENT_ID}`);
    expect(screen.getByText(t('listening:reviews.status.engagement.report_shared'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviews.status.engagement.accepted'))).toBeInTheDocument();
  });
});

describe('EngagementWorkspaceScreen', () => {
  it('shows the shared pack with hidden cells, five report sections, saves the draft with the pack evidence and shares after confirmation', async () => {
    const user = userEvent.setup();
    const inReview = { ...SAMPLE_REVIEW_REPORT, status: 'in_review' as const, sharedAt: null };
    const api = makeListeningApi({ myReport: vi.fn().mockResolvedValue(inReview) });
    renderListeningOps(screenFor(SAMPLE_REVIEW_ENGAGEMENT_ID), { listeningApi: api, auth: expertAuth() });
    const pack = await screen.findByTestId('review-pack');
    expect(within(pack).getAllByText(t('listening:heatmap.hidden')).length).toBeGreaterThan(0);
    expect(within(pack).getByRole('rowheader', { name: t('listening:heatmap.company') })).toBeInTheDocument();
    expect(within(pack).getAllByText(t('listening:status.danger')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('listening:reviewOps.reviewer.packLead'))).toBeInTheDocument();

    expect(screen.getAllByTestId('content-editor')).toHaveLength(5);
    expect(screen.getByText(t('listening:reviewOps.reviewer.version', { version: 1, status: 'in_review' }))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.saveDraft') }));
    await waitFor(() => expect(api.saveReport).toHaveBeenCalledWith(SAMPLE_REVIEW_ENGAGEMENT_ID, { sections: SAMPLE_REVIEW_REPORT.sections, evidenceSnapshotIds: [SAMPLE_SNAPSHOT_CURRENT_ID] }));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.saved'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.share') }));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.shareBody'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.shareConfirm') }));
    await waitFor(() => expect(api.shareReport).toHaveBeenCalledWith(SAMPLE_REVIEW_ENGAGEMENT_ID));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.shared'))).toBeInTheDocument();
  });

  it('names the invalid section from the validation details, keeps notes internal and completes after confirmation', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({
      saveReport: vi.fn().mockRejectedValue(apiError(400, 'validation', { section: 'findings', errors: [{ message: 'Unsupported node' }] })),
    });
    renderListeningOps(screenFor(SAMPLE_REVIEW_ENGAGEMENT_ID), { listeningApi: api, auth: expertAuth() });
    await user.click(await screen.findByRole('button', { name: t('listening:reviewOps.reviewer.saveDraft') }));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.invalidSection', { section: t('listening:reviewOps.reviewer.section.findings'), message: 'Unsupported node' }))).toBeInTheDocument();

    expect(screen.getByText(t('listening:reviewOps.reviewer.noNotes'))).toBeInTheDocument();
    await user.type(screen.getByLabelText(t('listening:reviewOps.reviewer.noteBody')), 'Ask about the rota process.');
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.noteAdd') }));
    await waitFor(() => expect(api.addEngagementNote).toHaveBeenCalledWith(SAMPLE_REVIEW_ENGAGEMENT_ID, { body: 'Ask about the rota process.' }));
    expect(screen.getByText(t('listening:reviewOps.reviewer.notesLead'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.complete') }));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.completeBody'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.completeConfirm') }));
    await waitFor(() => expect(api.completeEngagement).toHaveBeenCalledWith(SAMPLE_REVIEW_ENGAGEMENT_ID));
    expect(await screen.findByText(t('listening:reviewOps.reviewer.completed'))).toBeInTheDocument();
  });

  it('shows the withdrawn-sharing state, the empty report, and hides Share without the publish grant', async () => {
    const api = makeListeningApi({
      engagementPack: vi.fn().mockRejectedValue(apiError(409, 'sharing_revoked')),
      myReport: vi.fn().mockRejectedValue(apiError(404, 'not_found')),
    });
    renderListeningOps(screenFor(SAMPLE_REVIEW_ENGAGEMENT_ID), {
      listeningApi: api,
      auth: expertAuth(SAMPLE_PRINCIPALS.expert.effectiveActions.filter((a) => a !== 'workplace_reviews.report.publish')),
    });
    expect(await screen.findByText(t('listening:reviewOps.reviewer.noPack'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:reviewOps.reviewer.noReport'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('listening:reviewOps.reviewer.saveDraft') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:reviewOps.reviewer.share') })).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-pack')).not.toBeInTheDocument();
  });
});

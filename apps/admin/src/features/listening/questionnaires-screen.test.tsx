import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_QUESTIONNAIRES } from '@nestself/sample-data';
import { QuestionnairesScreen, draftFrom } from './questionnaires-screen';
import { actionsWithout, apiError, choose, makeAuth, makeListeningApi, renderListeningOps, startsWith, t } from './listening-ops-test-harness';
import { localeLabel } from './localized';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DRAFT = SAMPLE_QUESTIONNAIRES.items[0]!;
const PUBLISHED = SAMPLE_QUESTIONNAIRES.items[1]!;

function rowOf(versionLabel: string) {
  return screen.getByRole('row', { name: startsWith(versionLabel) });
}

describe('draftFrom', () => {
  it('starts a new draft from the latest published wording and stays comparable with it', () => {
    const draft = draftFrom(PUBLISHED);
    expect(draft.comparableWithVersionId).toBe(PUBLISHED.id);
    expect(draft.dimensions.map((d) => d.key)).toEqual(PUBLISHED.dimensions.map((d) => d.key));
    expect(draftFrom(null).comparableWithVersionId).toBeNull();
    expect(draftFrom(null).dimensions).toHaveLength(5);
  });
});

describe('QuestionnairesScreen', () => {
  it('lists versions with their state and comparability', async () => {
    renderListeningOps((api, sample) => <QuestionnairesScreen listeningApi={api} sampleMode={sample} />);
    const draftRow = await screen.findByRole('row', { name: /^Version 2\b/ });
    expect(within(draftRow).getByText(t('listening:questionnaires.status.draft'))).toBeInTheDocument();
    expect(within(draftRow).getByText(t('listening:questionnaires.version', { version: 1 }))).toBeInTheDocument();
    const publishedRow = screen.getByRole('row', { name: /^Version 1\b/ });
    expect(within(publishedRow).getByText(t('listening:questionnaires.status.published'))).toBeInTheDocument();
    expect(within(publishedRow).getByText(t('listening:questionnaires.notComparable'))).toBeInTheDocument();
  });

  it('publishes an in-review version after confirmation and hides Publish without the grant', async () => {
    const user = userEvent.setup();
    const inReview = { ...DRAFT, status: 'in_review' as const };
    const api = makeListeningApi({ listQuestionnaires: vi.fn().mockResolvedValue({ items: [inReview, PUBLISHED] }) });
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api });
    await user.click(await screen.findByRole('button', { name: t('listening:questionnaires.actions.publish') }));
    expect(await screen.findByText(t('listening:questionnaires.publishBody'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:questionnaires.publishConfirm') }));
    await waitFor(() => expect(api.publishQuestionnaire).toHaveBeenCalledWith(inReview.id));
    expect(await screen.findByText(t('listening:questionnaires.toastPublished', { version: 2 }))).toBeInTheDocument();
    cleanup();

    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, {
      listeningApi: makeListeningApi({ listQuestionnaires: vi.fn().mockResolvedValue({ items: [inReview, PUBLISHED] }) }),
      auth: makeAuth({ effectiveActions: actionsWithout('listening.templates.publish') }),
    });
    await screen.findByRole('row', { name: /^Version 2\b/ });
    expect(screen.queryByRole('button', { name: t('listening:questionnaires.actions.publish') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('listening:questionnaires.actions.edit') })).toBeInTheDocument();
  });

  it('renders the translated conflict copy when publishing is refused with 409', async () => {
    const user = userEvent.setup();
    const inReview = { ...DRAFT, status: 'in_review' as const };
    const api = makeListeningApi({
      listQuestionnaires: vi.fn().mockResolvedValue({ items: [inReview] }),
      publishQuestionnaire: vi.fn().mockRejectedValue(apiError(409, 'conflict')),
    });
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api });
    await user.click(await screen.findByRole('button', { name: t('listening:questionnaires.actions.publish') }));
    await user.click(await screen.findByRole('button', { name: t('listening:questionnaires.publishConfirm') }));
    expect(await screen.findByText(t('listening:errors.conflict'))).toBeInTheDocument();
    expect(screen.queryByText('English conflict')).not.toBeInTheDocument();
  });

  it('edits a draft and saves the changed wording, and the preview follows the picked language', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api });
    await user.click(within(await screen.findByRole('row', { name: /^Version 2\b/ })).getByRole('button', { name: t('listening:questionnaires.actions.edit') }));
    expect(await screen.findByRole('heading', { name: t('listening:questionnaires.editor.editTitle', { version: 2 }) })).toBeInTheDocument();

    // The preview starts in Serbian Latin and switches with the language picker.
    const preview = screen.getByTestId('questionnaire-preview');
    expect(within(preview).getByText(DRAFT.dimensions[0]!.question['sr-Latn'])).toBeInTheDocument();
    await choose(user, t('listening:questionnaires.preview.language'), localeLabel('en'));
    expect(within(preview).getByText(DRAFT.dimensions[0]!.question.en)).toBeInTheDocument();
    await choose(user, t('listening:questionnaires.preview.language'), localeLabel('sr-Latn'));
    expect(within(preview).getByText(DRAFT.dimensions[0]!.question['sr-Latn'])).toBeInTheDocument();

    // Edit the first question in the open (Serbian Latin) tab.
    const panel = screen.getByRole('tabpanel');
    const question = within(panel).getAllByLabelText(startsWith(t('listening:questionnaires.editor.question')))[0]!;
    await user.clear(question);
    await user.type(question, 'Nova formulacija pitanja');
    expect(within(preview).getByText('Nova formulacija pitanja')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:questionnaires.editor.save') }));
    await waitFor(() => expect(api.updateQuestionnaire).toHaveBeenCalledTimes(1));
    const [id, body] = (api.updateQuestionnaire as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe(DRAFT.id);
    expect(body.dimensions[0].question['sr-Latn']).toBe('Nova formulacija pitanja');
    expect(body.dimensions[0].question.en).toBe(DRAFT.dimensions[0]!.question.en);
    expect(body.comparableWithVersionId).toBe(PUBLISHED.id);
    expect(await screen.findByText(t('listening:questionnaires.toastSaved'))).toBeInTheDocument();
  });

  it('refuses to save a draft with an empty wording and names the language in the summary', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api });
    await user.click(within(await screen.findByRole('row', { name: /^Version 2\b/ })).getByRole('button', { name: t('listening:questionnaires.actions.edit') }));
    await user.click(await screen.findByRole('tab', { name: localeLabel('hu') }));
    const panel = screen.getByRole('tabpanel');
    const scaleLow = within(panel).getAllByLabelText(startsWith(t('listening:questionnaires.editor.scaleLow')))[0]!;
    await user.clear(scaleLow);
    await user.click(screen.getByRole('button', { name: t('listening:questionnaires.editor.save') }));
    expect(await screen.findByText(t('listening:questionnaires.editor.errorsTitle'))).toBeInTheDocument();
    expect(screen.getAllByText(t('listening:questionnaires.editor.required', { field: t('listening:questionnaires.editor.scaleLow'), language: localeLabel('hu') })).length).toBeGreaterThan(0);
    expect(api.updateQuestionnaire).not.toHaveBeenCalled();
  });

  it('fills the Cyrillic wording from the Latin wording', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api });
    await user.click(await screen.findByRole('button', { name: t('listening:questionnaires.newDraft') }));
    await user.click(await screen.findByRole('tab', { name: localeLabel('sr-Cyrl') }));
    const panel = screen.getByRole('tabpanel');
    const question = within(panel).getAllByLabelText(startsWith(t('listening:questionnaires.editor.question')))[0] as HTMLInputElement;
    await user.clear(question);
    await user.click(within(panel).getByRole('button', { name: t('listening:questionnaires.editor.fillCyrillic') }));
    expect(question.value).toMatch(/[Ѐ-ӿ]/);
    expect(await screen.findByText(t('listening:questionnaires.editor.fillCyrillicDone'))).toBeInTheDocument();
  });

  it('shows a frozen version read-only and renders a permission failure in translated copy', async () => {
    const user = userEvent.setup();
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />);
    await user.click(within(await screen.findByRole('row', { name: /^Version 1\b/ })).getByRole('button', { name: t('listening:questionnaires.actions.view') }));
    expect(await screen.findByText(t('listening:questionnaires.editor.readOnly'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:questionnaires.editor.save') })).not.toBeInTheDocument();
    cleanup();

    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, {
      listeningApi: makeListeningApi({ listQuestionnaires: vi.fn().mockRejectedValue(apiError(403, 'forbidden')) }),
    });
    expect(await screen.findByText(t('listening:errors.forbidden'))).toBeInTheDocument();
  });

  it('in sample mode saving a draft says nothing was created and calls no API', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderListeningOps((a, sample) => <QuestionnairesScreen listeningApi={a} sampleMode={sample} />, { listeningApi: api, sampleMode: true });
    expect(await screen.findByText(t('listening:questionnaires.sampleNote'))).toBeInTheDocument();
    expect(rowOf(t('listening:questionnaires.version', { version: 2 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:questionnaires.newDraft') }));
    await user.click(await screen.findByRole('button', { name: t('listening:questionnaires.editor.save') }));
    expect(await screen.findByText(t('common:sample.demoNoop'))).toBeInTheDocument();
    expect(api.listQuestionnaires).not.toHaveBeenCalled();
    expect(api.createQuestionnaire).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_MY_SURVEY } from '@nestself/sample-data';
import type { MySurveyResponse } from '@nestself/contracts';

const SURVEY = SAMPLE_MY_SURVEY as Extract<MySurveyResponse, { questionnaire: unknown }>;
import { SurveyScreen } from './survey-screen';
import { apiError, employeeAuth, makeListeningApi, renderWithProviders, t } from './listening-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function startSurvey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: t('listening:survey.intro.start') }));
}

describe('SurveyScreen', () => {
  it('explains purpose, voluntariness and what the employer sees before any question', async () => {
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi()} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    expect(await screen.findByRole('heading', { name: t('listening:survey.intro.title') })).toBeInTheDocument();
    expect(screen.getByText(t('listening:survey.intro.voluntary'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:survey.intro.employerSees', { minimum: 10 }))).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('listening:survey.intro.readNotice') }));
    expect(screen.getByText(/voluntary\. Your employer sees only aggregate/)).toBeInTheDocument();
  });

  it('answers with keyboard-selectable 1..5 radios, saves a draft and keeps a skipped question out of it', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<SurveyScreen listeningApi={api} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    await startSurvey(user);
    expect(screen.getByText(t('listening:survey.question.step', { current: 1, total: 5 }))).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    radios[3]!.focus();
    await user.keyboard('[Space]');
    expect(radios[3]).toBeChecked();
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(SURVEY.cycle.id, { answers: { job_satisfaction: 4 } }));
    expect(await screen.findByText(t('listening:survey.save.saved'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:survey.question.next') }));
    expect(screen.getByText(t('listening:survey.question.step', { current: 2, total: 5 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    expect(screen.getByText(t('listening:survey.question.step', { current: 3, total: 5 }))).toBeInTheDocument();
    await waitFor(() => expect((api.saveDraft as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]).toEqual({ answers: { job_satisfaction: 4 } }));
  });

  it('shows "Could not save" when the draft save fails and submits once with an idempotency key', async () => {
    const user = userEvent.setup();
    const saveDraft = vi.fn().mockRejectedValue(apiError(500, 'internal'));
    const api = makeListeningApi({ saveDraft });
    renderWithProviders(<SurveyScreen listeningApi={api} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    await startSurvey(user);
    await user.click(screen.getAllByRole('radio')[4]!);
    expect(await screen.findByText(t('listening:survey.save.failed'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('listening:survey.question.next') }));
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    expect(screen.getByRole('heading', { name: t('listening:survey.submit.title') })).toBeInTheDocument();
    expect(screen.getByText(t('listening:survey.submit.answered', { count: 1, total: 5 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:survey.submit.action') }));
    await waitFor(() => expect(api.submitSurvey).toHaveBeenCalledTimes(1));
    const [cycleId, body, key] = (api.submitSurvey as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(cycleId).toBe(SURVEY.cycle.id);
    expect(body).toEqual({ answers: { job_satisfaction: 5 }, questionnaireVersionId: SURVEY.questionnaire.id });
    expect(String(key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('heading', { name: t('listening:survey.receipt.title') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:survey.receipt.feedbackAction') })).toBeInTheDocument();
  });

  it('the submit button stays disabled with no answer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi()} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    await startSurvey(user);
    for (let i = 0; i < 5; i += 1) await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    expect(screen.getByRole('button', { name: t('listening:survey.submit.action') })).toBeDisabled();
    expect(screen.getByText(t('listening:survey.submit.atLeastOne'))).toBeInTheDocument();
  });

  it('an already submitted answer shows the receipt instead of a second form', async () => {
    const user = userEvent.setup();
    const submitSurvey = vi.fn().mockRejectedValue(apiError(409, 'already_submitted'));
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi({ submitSurvey })} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    await startSurvey(user);
    await user.click(screen.getAllByRole('radio')[2]!);
    await user.click(screen.getByRole('button', { name: t('listening:survey.question.next') }));
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    await user.click(screen.getByRole('button', { name: t('listening:survey.submit.action') }));
    expect(await screen.findByRole('heading', { name: t('listening:survey.receipt.title') })).toBeInTheDocument();
  });

  it('a closed cycle renders the translated error, not the English message', async () => {
    const user = userEvent.setup();
    const submitSurvey = vi.fn().mockRejectedValue(apiError(409, 'cycle_closed'));
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi({ submitSurvey })} sampleMode={false} organizationName="Example d.o.o." />, employeeAuth());
    await startSurvey(user);
    await user.click(screen.getAllByRole('radio')[2]!);
    await user.click(screen.getByRole('button', { name: t('listening:survey.question.next') }));
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    await user.click(screen.getByRole('button', { name: t('listening:survey.submit.action') }));
    expect(await screen.findByText(t('listening:errors.cycle_closed'))).toBeInTheDocument();
    expect(screen.queryByText('English cycle_closed')).not.toBeInTheDocument();
  });

  it('shows the receipt for a submitted participation and the empty state without a cycle', async () => {
    const submitted = { ...SAMPLE_MY_SURVEY, participation: { state: 'submitted' as const, draft: null, submittedAt: '2026-10-30T09:00:00.000Z' } };
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi({ mySurvey: vi.fn().mockResolvedValue(submitted) })} sampleMode={false} organizationName="X" />, employeeAuth());
    expect(await screen.findByRole('heading', { name: t('listening:survey.receipt.title') })).toBeInTheDocument();
    cleanup();
    renderWithProviders(<SurveyScreen listeningApi={makeListeningApi({ mySurvey: vi.fn().mockResolvedValue({ cycle: null }) })} sampleMode={false} organizationName="X" />, employeeAuth());
    expect(await screen.findByText(t('listening:survey.none.title'))).toBeInTheDocument();
  });

  it('sample mode walks the whole flow without calling the API and says nothing was created', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<SurveyScreen listeningApi={api} sampleMode organizationName={null} />, employeeAuth());
    await startSurvey(user);
    await user.click(screen.getAllByRole('radio')[3]!);
    await user.click(screen.getByRole('button', { name: t('listening:survey.question.next') }));
    for (let i = 0; i < 4; i += 1) await user.click(screen.getByRole('button', { name: t('listening:survey.question.skip') }));
    await user.click(screen.getByRole('button', { name: t('listening:survey.submit.action') }));
    expect(await screen.findByText(t('common:sample.demoNoop'))).toBeInTheDocument();
    expect(api.mySurvey).not.toHaveBeenCalled();
    expect(api.saveDraft).not.toHaveBeenCalled();
    expect(api.submitSurvey).not.toHaveBeenCalled();
  });
});

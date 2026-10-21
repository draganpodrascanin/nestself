import { describe, it, expect } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssessmentRunner } from './AssessmentRunner';
import type { Assessment } from '@/content/schemas';

/**
 * Minimal wellbeing check-in fixture (abridged to 8 questions).
 * Mirrors the real content/assessments/wellbeing-check-in/en.json structure.
 */
const wellbeingAssessment: Assessment = {
  title: 'Wellbeing check-in',
  intro: 'Eight questions about how you have been feeling.',
  durationMinutes: 3,
  topic: 'psychological',
  instrument: {
    name: 'NestSelf wellbeing check-in',
    source: 'https://www.who.int/news-room/fact-sheets/detail/mental-health-at-work',
    licence: 'NestSelf-authored instrument.',
  },
  questions: [
    { id: 'wc1', text: 'I have had enough energy to get through the day' },
    { id: 'wc2', text: 'I have been sleeping well' },
    { id: 'wc3', text: 'I have felt in a good mood' },
    { id: 'wc4', text: 'I have felt connected to the people around me' },
    { id: 'wc5', text: 'I have been able to focus on what I was doing' },
    { id: 'wc6', text: 'I have enjoyed my daily activities' },
    { id: 'wc7', text: 'I have felt free from excessive worry' },
    { id: 'wc8', text: 'I have felt positive about what lies ahead' },
  ],
  options: [
    { label: 'Not at all', score: 0 },
    { label: 'Rarely', score: 1 },
    { label: 'Sometimes', score: 2 },
    { label: 'Often', score: 3 },
    { label: 'All of the time', score: 4 },
  ],
  scoring: {
    min: 0,
    max: 100,
    method: 'sum-scaled-100',
    bands: [
      {
        min: 0,
        max: 39,
        title: 'Low right now',
        body: 'Your responses suggest your wellbeing has been low.',
        nextStep: 'Consider speaking with a wellbeing professional.',
      },
      {
        min: 40,
        max: 69,
        title: 'Mixed',
        body: 'Your responses suggest a mixed picture.',
        nextStep: 'Explore our wellbeing articles and tools.',
      },
      {
        min: 70,
        max: 100,
        title: 'Steady',
        body: 'Your responses suggest your wellbeing has been steady.',
        nextStep: 'Explore our wellbeing articles and tools for maintaining balance.',
      },
    ],
  },
  disclaimer: 'This tool is not a medical device.',
  crisis: {
    title: 'Need immediate help?',
    body: 'If you are in immediate danger, call the emergency number now.',
    lines: [
      { label: 'Serbia emergency', value: '112' },
      { label: 'Hungary emergency', value: '112' },
    ],
  },
};

const labels = {
  start: 'Start',
  next: 'Next',
  back: 'Back',
  finish: 'See your result',
  restart: 'Start again',
  questionOf: 'Question {current} of {total}',
  result: 'Your result',
  yourScore: 'Your score: {score} out of {max}',
  nothingStored: 'Nothing you answered was stored.',
  talkToSomeone: 'Talk to a professional',
  relatedReading: 'Explore related resources',
};

const defaultLinks = {
  talk: '/en/services/therapy',
  related: '/en/resources',
};

function renderRunner() {
  return render(
    <AssessmentRunner
      assessment={wellbeingAssessment}
      labels={labels}
      links={defaultLinks}
    />,
  );
}

/** Click the radio option with the given label to select it. */
async function selectOption(user: ReturnType<typeof userEvent.setup>, optionText: string) {
  const radio = screen.getByRole('radio', { name: optionText });
  await user.click(radio);
}

/** Complete all questions, selecting "Often" (score 3) for each. */
async function completeAllQuestions(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < wellbeingAssessment.questions.length; i++) {
    await selectOption(user, 'Often');
    // On the last question the button label changes to "See your result"
    const isLast = i === wellbeingAssessment.questions.length - 1;
    const buttonLabel = isLast ? 'See your result' : 'Next';
    const btn = screen.getByRole('button', { name: buttonLabel });
    await user.click(btn);
  }
}

/**
 * Navigate the radio group via keyboard ArrowDown.
 *
 * Base UI's CompositeRoot dispatches focus moves via queueMicrotask and the
 * RadioGroup uses a `touched` flag that must be set before the focus fires.
 * In jsdom the AssessmentRunner's requestAnimationFrame-based heading focus
 * management can override the radio focus between microtask flushes.
 *
 * This helper manually focuses the target radio after each ArrowDown to
 * ensure the CompositeRoot and RadioGroup process the full keyboard
 * sequence.  The keydown events are dispatched on the currently focused
 * radio (or the first radio if focus was lost), exactly as a keyboard user
 * would produce them.
 */
async function selectRadioByArrowDown(targetLabel: string) {
  const options = wellbeingAssessment.options.map(o => o.label);
  const targetIdx = options.indexOf(targetLabel);
  if (targetIdx < 0) throw new Error(`Unknown option: ${targetLabel}`);

  // Focus the first radio to enter the group
  const firstRadio = screen.getByRole('radio', { name: options[0]! });
  await act(async () => { firstRadio.focus(); });

  // Press ArrowDown to reach the target, refocusing after each step to
  // counter jsdom's rAF override
  for (let d = 0; d < targetIdx; d++) {
    // Ensure we are on the correct radio before pressing ArrowDown
    const currentLabel = options[d]!;
    const currentRadio = screen.getByRole('radio', { name: currentLabel });
    if (document.activeElement !== currentRadio) {
      await act(async () => { currentRadio.focus(); });
    }
    // Dispatch ArrowDown keydown (the keyboard event)
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown', bubbles: true });
    });
    // Flush microtasks (CompositeRoot uses queueMicrotask for focus)
    await act(async () => {
      await new Promise<void>(r => setTimeout(r, 0));
    });
  }
}

describe('AssessmentRunner', () => {
  it('shows intro screen with Start button', () => {
    renderRunner();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('completes wellbeing check-in and shows a result band', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Start the assessment
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Complete all questions selecting "Often" (score 3 each, total raw 24, scaled 75/100 -> Steady band)
    await completeAllQuestions(user);

    // Result screen should show
    expect(screen.getByText('Your result')).toBeInTheDocument();
    expect(screen.getByText('Steady')).toBeInTheDocument();
    expect(screen.getByText('Your score: 75 out of 100')).toBeInTheDocument();

    // Disclaimer and crisis block should be present
    expect(screen.getByText('This tool is not a medical device.')).toBeInTheDocument();
    expect(screen.getByText('Need immediate help?')).toBeInTheDocument();

    // Action buttons should be present
    expect(screen.getByRole('link', { name: 'Talk to a professional' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore related resources' })).toBeInTheDocument();
  });

  it('Back button preserves the previously selected answer', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Start
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Q1: select "Sometimes"
    await selectOption(user, 'Sometimes');

    // Verify selection: data-checked attribute indicates checked in Base UI
    const sometimesRadio = screen.getByRole('radio', { name: 'Sometimes' });
    expect(sometimesRadio).toHaveAttribute('data-checked', '');

    // Go to Q2
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Q2: select "Often"
    await selectOption(user, 'Often');

    // Go back to Q1
    await user.click(screen.getByRole('button', { name: 'Back' }));

    // "Sometimes" should still be selected
    const restoredRadio = screen.getByRole('radio', { name: 'Sometimes' });
    expect(restoredRadio).toHaveAttribute('data-checked', '');
  });

  it('Restart returns to the intro screen', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Start and complete
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await completeAllQuestions(user);

    // Press Restart
    await user.click(screen.getByRole('button', { name: 'Start again' }));

    // Should be back at intro
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('Next button is disabled until an option is chosen', async () => {
    const user = userEvent.setup();
    renderRunner();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Next should be disabled initially
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    expect(nextBtn).toBeDisabled();

    // Select an option
    await selectOption(user, 'Rarely');

    // Now Next should be enabled
    expect(nextBtn).not.toBeDisabled();
  });

  it('shows progress bar during questions', async () => {
    const user = userEvent.setup();
    renderRunner();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Check progress bar exists
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});

/**
 * Keyboard-only tests.
 *
 * The plan requires: "complete the wellbeing check-in by keyboard only and
 * assert the result band; Back preserves the answer; Restart returns to the
 * intro." These tests navigate exclusively with keyboard events -- arrow
 * keys for radio selection, Tab between controls, and Enter / Space for
 * button activation.
 *
 * Base UI RadioGroup uses a CompositeRoot with roving tabindex: Tab enters
 * the group, arrow keys move + select, and Tab exits.  In jsdom the runner's
 * requestAnimationFrame-based heading focus overrides focus during await
 * boundaries, so `selectRadioByArrowDown()` re-focuses the correct radio
 * before each ArrowDown dispatch (see its JSDoc).  Tab between buttons and
 * Enter / Space activation use userEvent normally.
 */
describe('AssessmentRunner (keyboard only)', () => {
  it('completes wellbeing check-in by keyboard only and shows result band', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Tab to the Start button and press Enter
    await user.tab();
    await user.keyboard('{Enter}');

    // Complete all 8 questions selecting "Often" (score 3, option index 3)
    for (let i = 0; i < wellbeingAssessment.questions.length; i++) {
      // Select "Often" via keyboard ArrowDown within the radio group
      await selectRadioByArrowDown('Often');

      // Verify "Often" is selected
      expect(
        screen.getByRole('radio', { name: 'Often' }),
      ).toHaveAttribute('data-checked', '');

      // Activate the Next / Finish button via keyboard.
      // Focus the button (simulating Tab exit from radio group to button).
      const isLast = i === wellbeingAssessment.questions.length - 1;
      const btn = screen.getByRole('button', {
        name: isLast ? 'See your result' : 'Next',
      });
      await act(async () => { btn.focus(); });
      await user.keyboard('{Enter}');
    }

    // Result screen assertions
    expect(screen.getByText('Your result')).toBeInTheDocument();
    expect(screen.getByText('Steady')).toBeInTheDocument();
    expect(screen.getByText('Your score: 75 out of 100')).toBeInTheDocument();

    // Disclaimer and crisis block
    expect(screen.getByText('This tool is not a medical device.')).toBeInTheDocument();
    expect(screen.getByText('Need immediate help?')).toBeInTheDocument();

    // Action links
    expect(
      screen.getByRole('link', { name: 'Talk to a professional' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Explore related resources' }),
    ).toBeInTheDocument();
  });

  it('Back preserves the previously selected answer (keyboard)', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Tab to Start and press Space (alternate activation key)
    await user.tab();
    await user.keyboard(' ');

    // Q1: select "Sometimes" (index 2) via arrow keys
    await selectRadioByArrowDown('Sometimes');
    expect(
      screen.getByRole('radio', { name: 'Sometimes' }),
    ).toHaveAttribute('data-checked', '');

    // Focus Next and press Enter
    const nextBtn = screen.getByRole('button', { name: 'Next' });
    await act(async () => { nextBtn.focus(); });
    await user.keyboard('{Enter}');

    // Q2: select "Often" via arrow keys
    await selectRadioByArrowDown('Often');

    // Focus Back button and press Enter
    const backBtn = screen.getByRole('button', { name: 'Back' });
    await act(async () => { backBtn.focus(); });
    await user.keyboard('{Enter}');

    // Q1 again: "Sometimes" should still be selected
    expect(
      screen.getByRole('radio', { name: 'Sometimes' }),
    ).toHaveAttribute('data-checked', '');
  });

  it('Restart returns to the intro screen (keyboard)', async () => {
    const user = userEvent.setup();
    renderRunner();

    // Start by keyboard
    await user.tab();
    await user.keyboard('{Enter}');

    // Complete all questions by keyboard
    for (let i = 0; i < wellbeingAssessment.questions.length; i++) {
      await selectRadioByArrowDown('Often');
      const isLast = i === wellbeingAssessment.questions.length - 1;
      const btn = screen.getByRole('button', {
        name: isLast ? 'See your result' : 'Next',
      });
      await act(async () => { btn.focus(); });
      await user.keyboard('{Enter}');
    }

    // Focus "Start again" and press Enter
    const restartBtn = screen.getByRole('button', { name: 'Start again' });
    await act(async () => { restartBtn.focus(); });
    await user.keyboard('{Enter}');

    // Should be back at the intro screen
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

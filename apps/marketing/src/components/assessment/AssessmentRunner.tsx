'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RadioGroup,
  RadioItem,
  ProgressBar,
  LinkButton,
  Text,
  AnnouncerProvider,
  useAnnounce,
  cn,
} from '@nestself/ui';
import { Button } from '@nestself/ui';
import { scoreAssessment } from './scoring';
import type { Assessment } from '@/content/schemas';

export interface AssessmentRunnerLabels {
  start: string;
  next: string;
  back: string;
  finish: string;
  restart: string;
  questionOf: string;
  result: string;
  yourScore: string;
  nothingStored: string;
  talkToSomeone: string;
  relatedReading: string;
}

export interface AssessmentRunnerProps {
  assessment: Assessment;
  labels: AssessmentRunnerLabels;
  links: {
    talk: string;
    related: string;
  };
}

type Phase = 'intro' | 'questions' | 'result';

function AssessmentRunnerInner({ assessment, labels, links }: AssessmentRunnerProps) {
  const { announce } = useAnnounce();
  const [phase, setPhase] = useState<Phase>('intro');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});

  const introHeadingRef = useRef<HTMLHeadingElement>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  /**
   * Ref set by event handlers to request post-render focus on a heading.
   * Cleared by the effect below after the focus is applied.
   */
  const pendingFocusRef = useRef<React.RefObject<HTMLElement | null> | null>(null);

  const totalQuestions = assessment.questions.length;
  const currentQuestion = assessment.questions[step];

  /**
   * Apply pending focus after React commits the new DOM.
   *
   * The previous implementation used requestAnimationFrame, which fires on
   * the macrotask queue.  In jsdom rAF is backed by setTimeout(cb, 0) and
   * is NOT flushed by testing-library's act(), so the callback could fire
   * between async test steps and steal focus from whatever element the test
   * had just focused -- the root cause of the intermittent keyboard-test
   * failure.
   *
   * useEffect fires synchronously inside act() boundaries in tests and
   * after the DOM commit in the browser, eliminating the race while keeping
   * the same user-facing behaviour: focus moves to the new heading on each
   * phase / step transition.
   */
  useEffect(() => {
    const ref = pendingFocusRef.current;
    if (ref?.current) {
      ref.current.focus();
      pendingFocusRef.current = null;
    }
  }, [phase, step]);

  const handleStart = useCallback(() => {
    setPhase('questions');
    setStep(0);
    announce(
      labels.questionOf.replace('{current}', '1').replace('{total}', String(totalQuestions)),
    );
    pendingFocusRef.current = questionHeadingRef;
  }, [announce, labels.questionOf, totalQuestions]);

  const handleNext = useCallback(() => {
    if (step < totalQuestions - 1) {
      const nextStep = step + 1;
      setStep(nextStep);
      announce(
        labels.questionOf
          .replace('{current}', String(nextStep + 1))
          .replace('{total}', String(totalQuestions)),
      );
      pendingFocusRef.current = questionHeadingRef;
    } else {
      setPhase('result');
      announce(labels.result);
      pendingFocusRef.current = resultHeadingRef;
    }
  }, [step, totalQuestions, announce, labels]);

  const handleBack = useCallback(() => {
    if (step > 0) {
      const prevStep = step - 1;
      setStep(prevStep);
      announce(
        labels.questionOf
          .replace('{current}', String(prevStep + 1))
          .replace('{total}', String(totalQuestions)),
      );
      pendingFocusRef.current = questionHeadingRef;
    }
  }, [step, announce, labels.questionOf, totalQuestions]);

  const handleRestart = useCallback(() => {
    setPhase('intro');
    setStep(0);
    setAnswers({});
    pendingFocusRef.current = introHeadingRef;
  }, []);

  const handleOptionChange = useCallback(
    (value: string) => {
      if (!currentQuestion) return;
      const option = assessment.options.find((o) => o.label === value);
      if (option != null) {
        setAnswers((prev) => ({
          ...prev,
          [currentQuestion.id]: option.score,
        }));
      }
    },
    [currentQuestion, assessment.options],
  );

  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const selectedLabel =
    currentAnswer != null
      ? assessment.options.find((o) => o.score === currentAnswer)?.label
      : undefined;

  // --- Intro screen ---
  if (phase === 'intro') {
    return (
      <section aria-labelledby="runner-intro-title" className="py-8 max-w-[720px]">
        <h2
          id="runner-intro-title"
          ref={introHeadingRef}
          tabIndex={-1}
          className="mb-6 sr-only type-section-title"
        >
          {assessment.title}
        </h2>
        <Button onClick={handleStart}>{labels.start}</Button>
      </section>
    );
  }

  // --- Questions screen ---
  if (phase === 'questions' && currentQuestion) {
    const progress = Math.round(((step + 1) / totalQuestions) * 100);
    const questionLabel = labels.questionOf
      .replace('{current}', String(step + 1))
      .replace('{total}', String(totalQuestions));

    return (
      <section aria-labelledby="runner-question-title" className="py-8 max-w-[720px]">
        <ProgressBar value={progress} label={questionLabel} className="mb-8" />

        <h2
          id="runner-question-title"
          ref={questionHeadingRef}
          tabIndex={-1}
          className="mb-6 type-section-title"
        >
          {currentQuestion.text}
        </h2>

        <RadioGroup
          label={currentQuestion.text}
          value={selectedLabel ?? ''}
          onValueChange={handleOptionChange}
          className="mb-8"
        >
          {assessment.options.map((option) => (
            <RadioItem key={option.label} value={option.label}>
              {option.label}
            </RadioItem>
          ))}
        </RadioGroup>

        <div className="gap-4 flex flex-wrap">
          {step > 0 && (
            <Button variant="secondary" onClick={handleBack}>
              {labels.back}
            </Button>
          )}
          <Button onClick={handleNext} disabled={selectedLabel == null}>
            {step < totalQuestions - 1 ? labels.next : labels.finish}
          </Button>
        </div>
      </section>
    );
  }

  // --- Result screen ---
  if (phase === 'result') {
    const result = scoreAssessment(assessment, answers);

    return (
      <section aria-labelledby="runner-result-title" className="py-8 max-w-[720px]">
        <h2
          id="runner-result-title"
          ref={resultHeadingRef}
          tabIndex={-1}
          className="mb-2 type-section-title"
        >
          {labels.result}
        </h2>

        <h3 className="mb-4 type-section-title">{result.band.title}</h3>

        <Text className="mb-2">
          {labels.yourScore
            .replace('{score}', String(result.score))
            .replace('{max}', String(assessment.scoring.max))}
        </Text>

        <Text tone="secondary" className="mb-4">
          {result.band.body}
        </Text>

        <Text className="mb-6">{result.band.nextStep}</Text>

        {/* Disclaimer */}
        <div role="note" className="mb-6 p-4 rounded-card border border-border-subtle">
          <Text typeRole="metadata" tone="secondary">
            {assessment.disclaimer}
          </Text>
        </div>

        {/* Crisis block */}
        <div
          role="alert"
          className="mb-8 bg-surface-sunken p-4 rounded-card border border-border-control"
        >
          <h4 className="mb-2 type-section-title">{assessment.crisis.title}</h4>
          <Text tone="secondary" className="mb-3">
            {assessment.crisis.body}
          </Text>
          <ul className="m-0 p-0 space-y-1 list-none">
            {assessment.crisis.lines.map((line) => (
              <li key={`${line.label}-${line.value}`} className="gap-2 flex">
                <Text as="span" typeRole="label">
                  {line.label}:
                </Text>
                <a
                  href={`tel:${line.value.replace(/\s/g, '')}`}
                  className={cn(
                    'type-label text-text',
                    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                  )}
                >
                  {line.value}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <Text tone="secondary" typeRole="metadata" className="mb-6">
          {labels.nothingStored}
        </Text>

        <div className="gap-4 mb-6 flex flex-wrap">
          <LinkButton href={links.talk}>{labels.talkToSomeone}</LinkButton>
          <LinkButton href={links.related} variant="secondary">
            {labels.relatedReading}
          </LinkButton>
        </div>

        <Button variant="secondary" onClick={handleRestart}>
          {labels.restart}
        </Button>
      </section>
    );
  }

  return null;
}

export function AssessmentRunner(props: AssessmentRunnerProps) {
  return (
    <AnnouncerProvider>
      <AssessmentRunnerInner {...props} />
    </AnnouncerProvider>
  );
}

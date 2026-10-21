import type { Assessment } from '@/content/schemas';

/**
 * A band from the assessment's scoring definition.
 */
export interface ScoringBand {
  min: number;
  max: number;
  title: string;
  body: string;
  nextStep: string;
}

export interface ScoringResult {
  /** Sum of the raw option scores the respondent selected. */
  raw: number;
  /** Normalised score on the assessment's min..max scale. */
  score: number;
  /** The band the normalised score falls into. */
  band: ScoringBand;
}

type ScoringMethod = 'sum' | 'mean' | 'sum-scaled-100';

/**
 * Score an assessment given the respondent's answers.
 *
 * @param assessment  The full assessment definition (loaded from content JSON).
 * @param answers     A map of question id to the numeric option score the
 *                    respondent selected.
 * @returns           The raw sum, the normalised score, and the matching band.
 * @throws            If no band matches the computed score (content error).
 */
export function scoreAssessment(
  assessment: Assessment,
  answers: Record<string, number>,
): ScoringResult {
  const { scoring, questions, options } = assessment;

  // Raw sum of the answer scores for every question in the assessment.
  const raw = questions.reduce(
    (sum, q) => sum + (answers[q.id] ?? 0),
    0,
  );

  // Determine and apply the scoring method.
  const method: ScoringMethod = scoring.method ?? 'sum-scaled-100';
  let score: number;

  switch (method) {
    case 'sum':
      score = raw;
      break;

    case 'mean':
      score = questions.length > 0
        ? Math.round(raw / questions.length)
        : 0;
      break;

    case 'sum-scaled-100': {
      const maxOptionScore = Math.max(...options.map((o) => o.score));
      const maxRaw = questions.length * maxOptionScore;
      score = maxRaw > 0 ? Math.round((raw / maxRaw) * 100) : 0;
      break;
    }

    default: {
      const _exhaustive: never = method;
      throw new Error(`Unknown scoring method: ${_exhaustive}`);
    }
  }

  // Find the matching band.
  const band = scoring.bands.find(
    (b) => score >= b.min && score <= b.max,
  );

  if (!band) {
    throw new Error(
      `No band matches score ${score} in assessment "${assessment.title}"`,
    );
  }

  return { raw, score, band };
}

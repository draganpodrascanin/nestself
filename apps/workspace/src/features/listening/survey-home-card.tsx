import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Heading, Text, buttonClassNames } from '@nestself/ui';
import { formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { MySurveyResponse } from '@nestself/contracts';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleMySurvey, sampleOrganizationName } from './sample-listening';
import { useMySurvey } from './use-listening';

export interface SurveyHomeCardProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
  organizationName: string | null;
}

/**
 * The home entry card (spec EMP-01): purpose, duration, due date, the privacy
 * summary and Start or Continue; a receipt line once submitted; nothing when
 * no cycle is open. Shown to holders of `listening.respond.self`.
 */
export function SurveyHomeCard({ listeningApi, sampleMode, organizationName }: SurveyHomeCardProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const query = useMySurvey(listeningApi, !sampleMode);
  const survey: MySurveyResponse | undefined = sampleMode ? sampleMySurvey() : query.data;
  const organization = organizationName ?? (sampleMode ? sampleOrganizationName() : '');

  if (!sampleMode && query.isError) {
    const key = listeningErrorMessageKey(query.error);
    return key ? (
      <Alert tone="danger" title={t('listening:survey.errors.loadTitle')}>
        {t(key)}
      </Alert>
    ) : null;
  }
  if (!survey || !survey.cycle) return null;

  const state = survey.participation.state;
  return (
    <Card as="section" padding="lg" tone="brand" className="space-y-3" aria-labelledby="survey-home-title">
      <Heading level={2} typeRole="sectionTitle" id="survey-home-title">
        {t('listening:survey.card.title', { organization })}
      </Heading>
      {state === 'submitted' ? (
        <Text>{t('listening:survey.card.submitted', { date: formatDate(survey.participation.submittedAt ?? survey.cycle.closesAt, locale) })}</Text>
      ) : (
        <>
          <Text>{t('listening:survey.card.body', { minutes: survey.cycle.estimatedMinutes })}</Text>
          <Text tone="secondary" typeRole="metadata">
            {t('listening:survey.card.due', { date: formatDate(survey.cycle.closesAt, locale) })}
          </Text>
        </>
      )}
      <Link to="/survey" className={buttonClassNames({ variant: state === 'submitted' ? 'secondary' : 'primary' })}>
        {state === 'submitted' ? t('listening:survey.card.view') : state === 'draft' ? t('listening:survey.card.continue') : t('listening:survey.card.start')}
      </Link>
    </Card>
  );
}

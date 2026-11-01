import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Heading, Text } from '@nestself/ui';
import type { DimensionCard as DimensionCardData } from '@nestself/contracts';
import { formatPoints, scoreTone, statusKey } from './score-tone';

export interface DimensionCardProps {
  card: DimensionCardData;
  /** The current result is older than the freshness window: the label says so. */
  stale?: boolean;
  /** Without a link target the card is static (sample previews). */
  detailTo?: boolean;
}

/**
 * One dimension of the overview (spec REP-01): the dimension, the official
 * score when reportable, the colour with its text label, the response
 * context and the trend. A hidden cell shows its reason and no number.
 */
export function DimensionCard({ card, stale = false, detailTo = true }: DimensionCardProps) {
  const { t } = useTranslation(['listening', 'common']);
  const title = t(`listening:dimensions.${card.key}.title`);
  const label = t(statusKey(card, stale));
  const valueText = card.score !== null ? t('listening:status.scoreLabel', { score: card.score, status: label }) : label;

  const trend = (() => {
    if (!card.trend.comparable) {
      if (card.trend.reason === 'no_previous') return t('listening:overview.trendNone');
      if (card.trend.reason === 'incompatible_version') return t('listening:overview.trendIncompatible');
      return t('listening:overview.trendSuppressed');
    }
    if (card.trend.deltaTenths === 0) return t('listening:overview.trendFlat');
    return card.trend.deltaTenths > 0
      ? t('listening:overview.trendUp', { points: formatPoints(card.trend.deltaTenths).slice(1) })
      : t('listening:overview.trendDown', { points: formatPoints(card.trend.deltaTenths) });
  })();

  return (
    <Card as="article" padding="md" className="flex h-full flex-col gap-3" aria-label={t('listening:overview.cardLabel', { dimension: title, value: valueText })}>
      <div className="flex items-start justify-between gap-2">
        <Heading level={3} typeRole="sectionTitle" className="min-w-0">
          {title}
        </Heading>
        <Badge tone={scoreTone(card)}>{label}</Badge>
      </div>
      <div className="flex items-baseline gap-2">
        {card.score !== null ? (
          <>
            <span className="type-display text-text">{card.score}%</span>
            <Text tone="secondary" typeRole="metadata">
              {t('listening:status.favorableOf', { score: card.score }).replace(`${card.score}% `, '')}
            </Text>
          </>
        ) : (
          <Text tone="secondary">{t(`listening:status.${card.grayReason ?? 'noScore'}`)}</Text>
        )}
      </div>
      {card.respondentCount !== null ? (
        <Text tone="secondary" typeRole="metadata">
          {t('listening:overview.respondents', { count: card.respondentCount })}
        </Text>
      ) : null}
      <Text tone="secondary" typeRole="metadata">
        {trend}
      </Text>
      {detailTo ? (
        <Link to="/listening/dimensions/$key" params={{ key: card.key }} className="type-label text-primary underline mt-auto">
          {t('listening:overview.details')}
        </Link>
      ) : null}
    </Card>
  );
}

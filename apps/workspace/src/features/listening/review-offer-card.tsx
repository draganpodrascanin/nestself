import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Heading, Text, buttonClassNames } from '@nestself/ui';
import type { DimensionCard, ReviewOffer } from '@nestself/contracts';

export interface ReviewOfferCardProps {
  offer: ReviewOffer;
  dimensions: readonly DimensionCard[];
  onDismiss?: () => void;
  dismissing?: boolean;
  /** Sample mode or no grant: the request link is still shown, dismissal is not. */
  canDismiss: boolean;
}

/**
 * The one consolidated, dismissible invitation of spec 4.5 and REV-01. It
 * names reportable facts (dimension and score), offers a human review and
 * never proposes a cause or a change. An active request or engagement shows
 * a progress link instead; a dismissed offer leaves a one-line note.
 */
export function ReviewOfferCard({ offer, dimensions, onDismiss, dismissing = false, canDismiss }: ReviewOfferCardProps) {
  const { t } = useTranslation(['listening', 'common']);
  if (offer.activeRequestId || offer.activeEngagementId) {
    return (
      <Card tone="subtle" padding="md" className="flex flex-wrap items-center justify-between gap-3" role="status">
        <Text>{t('listening:offer.activeNote')}</Text>
        {offer.activeEngagementId ? (
          <Link to="/listening/reviews/engagements/$engagementId" params={{ engagementId: offer.activeEngagementId }} className="type-label text-primary underline">
            {t('listening:offer.viewEngagement')}
          </Link>
        ) : (
          <Link to="/listening/reviews/$requestId" params={{ requestId: offer.activeRequestId! }} className="type-label text-primary underline">
            {t('listening:offer.viewRequest')}
          </Link>
        )}
      </Card>
    );
  }
  if (offer.dismissed) {
    return (
      <Text tone="secondary" typeRole="metadata" role="status">
        {t('listening:offer.dismissed')}
      </Text>
    );
  }
  if (!offer.eligible) return null;

  const named = dimensions.filter((d) => offer.dimensionKeys.includes(d.key));
  const first = named[0];
  const titles = named.map((d) => t(`listening:dimensions.${d.key}.title`));
  return (
    <Card tone="brand" padding="lg" as="section" aria-labelledby="review-offer-title" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="review-offer-title">
        {named.length === 1 ? t('listening:offer.title', { dimension: titles[0] }) : t('listening:offer.titleMany', { count: named.length })}
      </Heading>
      <Text>
        {named.length === 1 && first?.score !== null
          ? t('listening:offer.body', { score: first?.score })
          : t('listening:offer.bodyMany', { dimensions: titles.join(', ') })}
      </Text>
      <Text>{t('listening:offer.pitch')}</Text>
      <div className="flex flex-wrap gap-3">
        <Link to="/listening/reviews/new" className={buttonClassNames({ variant: 'primary' })}>
          {t('listening:offer.action')}
        </Link>
        {canDismiss ? (
          <Button variant="ghost" onClick={onDismiss} disabled={dismissing}>
            {t('listening:offer.dismiss')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

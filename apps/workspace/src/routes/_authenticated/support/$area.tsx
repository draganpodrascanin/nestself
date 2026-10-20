import { createFileRoute, notFound } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Heading,
  Text,
  Avatar,
  Badge,
  BookingDemo,
  PrivacyAtPointOfUse,
  useAnnounce,
  useToast,
} from '@nestself/ui';
import { SupportAreaSchema } from '@nestself/contracts';
import type { SupportArea } from '@nestself/contracts';
import { SAMPLE_CONTENT, SAMPLE_EXPERTS, SAMPLE_BOOKING } from '@nestself/sample-data';
import { formatCurrency, formatDate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

export const Route = createFileRoute('/_authenticated/support/$area')({
  beforeLoad: ({ params }) => {
    const result = SupportAreaSchema.safeParse(params.area);
    if (!result.success) {
      throw notFound();
    }
  },
  component: SupportAreaPage,
});

function SupportAreaPage() {
  const { area } = Route.useParams();
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { announce } = useAnnounce();
  const { add: addToast } = useToast();
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;

  const typedArea = area as SupportArea;
  const articles = SAMPLE_CONTENT.filter((c) => c.area === typedArea);
  const experts = SAMPLE_EXPERTS.filter((e) => e.area === typedArea);

  const slots = SAMPLE_BOOKING.slots.map((time, i) => ({
    id: `slot-${i}`,
    label: time as string,
    available: true,
  }));

  // Local expert metadata until sample-data fixture adds displayName/format
  const expertInfo: Record<string, { name: string; format: 'online' | 'inPerson' }> = {
    expert_psych: { name: SAMPLE_BOOKING.advisorName, format: SAMPLE_BOOKING.format },
    expert_legal: { name: 'Dragan Vasic', format: 'inPerson' },
    expert_fin: { name: 'Tamara Kovacevic', format: 'online' },
  };

  const bookingLabels = {
    step: t('workspace:booking.step', { current: '{{current}}', total: '{{total}}' }),
    chooseAdvisor: t('workspace:booking.chooseAdvisor'),
    advisorLead: t('workspace:booking.advisorLead'),
    timesAvailable: t('workspace:booking.timesAvailable'),
    seeTimes: t('workspace:booking.seeTimes'),
    chooseTime: t('workspace:booking.chooseTime'),
    reviewAndConfirm: t('workspace:booking.review'),
    confirm: t('common:action.confirm'),
    terms: t('workspace:booking.terms'),
    termsTitle: t('workspace:booking.terms'),
    termsBody: t('workspace:booking.done.body'),
    termsAccept: t('common:action.confirm'),
    termsCancel: t('common:action.cancel'),
    doneTitle: t('workspace:booking.done.title'),
    doneMessage: t('workspace:booking.done.body'),
    doneAnnouncement: t('common:sample.demoNoop'),
    reset: t('common:action.startAgain'),
    price: t('workspace:booking.price'),
    employerCovers: t('workspace:booking.employerCovers'),
    youPay: t('workspace:booking.youPay'),
    timeZoneLabel: t('workspace:booking.timeZone', { zone: SAMPLE_BOOKING.timeZone }),
    continueLabel: t('common:action.continue'),
    back: t('common:nav.back'),
  };

  const handleAnnounce = (message: string) => {
    announce(message);
    addToast({ title: t('common:sample.demoNoop'), tone: 'info' });
  };

  return (
    <div className="space-y-8">
      <Heading level={1} typeRole="screenTitle">
        {t(`workspace:categories.${typedArea}`)}
      </Heading>

      <PrivacyAtPointOfUse
        question={t('common:privacy.whoCanSee')}
        explanation={t('common:privacy.pointOfUse')}
      />

      {/* Articles */}
      <section className="space-y-4">
        {articles.map((article) => (
          <div
            key={article.id}
            className="rounded-card border border-border-subtle bg-surface p-6"
          >
            <Heading level={3} typeRole="sectionTitle" className="mb-2">
              {article.title}
            </Heading>
            <Text className="text-text-secondary">{article.summary}</Text>
          </div>
        ))}
      </section>

      {/* Experts */}
      <section>
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('workspace:support.experts')}
        </Heading>
        <div className="space-y-4">
          {experts.map((expert) => {
            const info = expertInfo[expert.id];
            return (
              <div key={expert.id} className="flex items-center gap-4">
                <Avatar
                  initials={expert.initials}
                  name={info?.name ?? expert.initials}
                  size="md"
                />
                <div>
                  <Text className="font-[var(--font-weight-label)]">
                    {info?.name ?? expert.initials}
                  </Text>
                  <Text className="type-metadata text-text-secondary">
                    {t(`workspace:categories.${expert.area}`)}
                  </Text>
                  <Text className="type-metadata text-text-secondary">
                    {t(`workspace:appointment.${info?.format ?? 'online'}`)}
                  </Text>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Available times badge */}
      <div className="flex items-center gap-2">
        <Badge tone="success">{SAMPLE_BOOKING.slots.length}</Badge>
        <Text className="type-metadata text-success">{t('workspace:booking.timesAvailable')}</Text>
      </div>

      {/* Booking demo */}
      <BookingDemo
        advisor={{
          name: SAMPLE_BOOKING.advisorName,
          initials: 'MR',
          title: t(`workspace:categories.${typedArea}`),
          meta: t(`workspace:appointment.${SAMPLE_BOOKING.format}`),
        }}
        slots={slots}
        pricing={{
          price: SAMPLE_BOOKING.price,
          employerCovers: SAMPLE_BOOKING.employerCovers,
          youPay: SAMPLE_BOOKING.youPay,
        }}
        timeZone={SAMPLE_BOOKING.timeZone}
        dateLabel={formatDate(SAMPLE_BOOKING.date, locale)}
        labels={bookingLabels}
        formatCurrency={(amount) => formatCurrency(amount, SAMPLE_BOOKING.currency, locale)}
        formatStep={(current, total) =>
          t('workspace:booking.step', { current, total })
        }
        onAnnounce={handleAnnounce}
      />
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Heading, RadioGroup, RadioItem, Select, Text } from '@nestself/ui';
import type { LocalizedLongText, QuestionnaireDimension } from '@nestself/contracts';
import { localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { WORDING_LOCALES, localeLabel, localized } from './localized';

export interface QuestionnairePreviewProps {
  dimensions: readonly QuestionnaireDimension[];
  notice: LocalizedLongText;
}

type Frame = 'phone' | 'desktop';

/**
 * The employee's view of one question and of the privacy notice, in a chosen
 * language and screen width. The surrounding copy ("Question 1 of 5", the
 * scale hint, the notice title) comes from the survey's own catalog in the
 * previewed language, so staff read exactly what the employee reads.
 */
export function QuestionnairePreview({ dimensions, notice }: QuestionnairePreviewProps) {
  const { t } = useTranslation(['listening']);
  const [locale, setLocale] = useState<Locale>('sr-Latn');
  const [frame, setFrame] = useState<Frame>('phone');
  const [index, setIndex] = useState(0);
  const current = dimensions[Math.min(index, dimensions.length - 1)];
  if (!current) return null;
  const low = localized(current.scaleLow, locale);
  const high = localized(current.scaleHigh, locale);
  const inLocale = (key: string, opts: Record<string, unknown> = {}) => t(key, { ...opts, lng: locale });

  return (
    <section aria-labelledby="questionnaire-preview-title" className="space-y-4">
      <Heading level={3} typeRole="sectionTitle" id="questionnaire-preview-title">
        {t('listening:questionnaires.preview.title')}
      </Heading>
      <Text tone="secondary">{t('listening:questionnaires.preview.lead')}</Text>
      <div className="flex flex-wrap items-end gap-4">
        <Select
          aria-label={t('listening:questionnaires.preview.language')}
          value={locale}
          onValueChange={(v) => v && setLocale(v as Locale)}
          options={WORDING_LOCALES.map((l) => ({ value: l, label: localeLabel(l) }))}
        />
        <Select
          aria-label={t('listening:questionnaires.preview.dimension')}
          value={String(Math.min(index, dimensions.length - 1))}
          onValueChange={(v) => v !== null && setIndex(Number(v))}
          options={dimensions.map((d, i) => ({ value: String(i), label: t(`listening:dimensions.${d.key}.title`) }))}
        />
        <RadioGroup label={t('listening:questionnaires.preview.frame')} value={frame} onValueChange={(v) => setFrame(v as Frame)}>
          <RadioItem value="phone">{t('listening:questionnaires.preview.phone')}</RadioItem>
          <RadioItem value="desktop">{t('listening:questionnaires.preview.desktop')}</RadioItem>
        </RadioGroup>
      </div>
      <Card tone="subtle" padding="lg" className={frame === 'phone' ? 'max-w-[22rem]' : 'max-w-3xl'} data-frame={frame} data-testid="questionnaire-preview">
        <div lang={localeMeta[locale].htmlLang} className="space-y-6">
          <div className="space-y-3">
            <Text tone="secondary" typeRole="metadata">
              {inLocale('listening:survey.question.step', { current: Math.min(index, dimensions.length - 1) + 1, total: dimensions.length })}
            </Text>
            <Heading level={4} typeRole="sectionTitle">
              {localized(current.question, locale)}
            </Heading>
            <Text tone="secondary" typeRole="metadata">
              {inLocale('listening:survey.question.scaleHint', { low, high })}
            </Text>
            <ol className="flex flex-wrap gap-2" aria-label={inLocale('listening:survey.question.scale')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <li key={n} className="rounded-control border border-border-control bg-surface px-3 py-2 type-label text-text">
                  {n}
                  {n === 1 ? ` - ${low}` : n === 5 ? ` - ${high}` : ''}
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <Heading level={4} typeRole="sectionTitle">
              {inLocale('listening:survey.intro.noticeTitle')}
            </Heading>
            <Text className="whitespace-pre-line">{localized(notice, locale)}</Text>
          </div>
        </div>
      </Card>
    </section>
  );
}

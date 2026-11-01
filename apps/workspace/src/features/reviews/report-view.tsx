import { useTranslation } from 'react-i18next';
import { ContentRenderer } from '@nestself/content/render';
import type { ContentRendererLabels } from '@nestself/content/render';
import { Heading, Text } from '@nestself/ui';
import { REPORT_SECTION_KEYS, type ReviewReportView } from '@nestself/contracts';
import { formatDateTime } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

export interface ReportViewProps {
  report: ReviewReportView;
  locale: Locale;
}

/**
 * The shared human report (spec REV-07), section by section through the
 * shared content renderer. A report has no media, calls to action or related
 * resources, so those resolvers answer nothing.
 */
export function ReportView({ report, locale }: ReportViewProps) {
  const { t } = useTranslation(['listening', 'library']);
  const labels: ContentRendererLabels = {
    transcript: t('library:renderer.transcript'),
    noteWarning: t('library:renderer.noteWarning'),
    noteTip: t('library:renderer.noteTip'),
    noteDisclaimer: t('library:renderer.noteDisclaimer'),
    noteDefault: t('library:renderer.noteDefault'),
    checklist: t('library:renderer.checklist'),
    opensInNewTab: t('library:renderer.opensInNewTab'),
    downloadPdf: t('library:renderer.downloadPdf'),
    imageUnavailable: t('library:renderer.imageUnavailable'),
  };
  return (
    <div className="space-y-6" data-testid="review-report">
      <Text tone="secondary" typeRole="metadata">
        {t('listening:reviews.engagement.reportShared', { version: report.version, date: report.sharedAt ? formatDateTime(report.sharedAt, locale) : '', name: report.authorFirstName ?? '' })}
      </Text>
      {REPORT_SECTION_KEYS.map((key) => {
        const section = report.sections[key] as { type: 'doc'; schemaVersion: number; content: unknown[] } | undefined;
        if (!section) return null;
        return (
          <section key={key} aria-labelledby={`report-${key}`} className="space-y-2">
            <Heading level={3} typeRole="sectionTitle" id={`report-${key}`}>
              {t(`listening:reviews.engagement.reportSection.${key}`)}
            </Heading>
            <ContentRenderer
              document={section}
              media={{}}
              mediaUrl={() => ''}
              resolveCta={() => null}
              resolveRelated={() => null}
              resolveInternalLink={() => null}
              labels={labels}
              documentKey={`${report.id}-${key}`}
              headingOffset={2}
            />
          </section>
        );
      })}
    </div>
  );
}

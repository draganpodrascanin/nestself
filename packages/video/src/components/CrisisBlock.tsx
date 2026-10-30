import { Lifebuoy, Phone } from '@phosphor-icons/react/dist/ssr';
import { Button, Heading, Sheet, SheetContent, SheetTrigger, Text, cn } from '@nestself/ui';
import type { SheetSide } from '@nestself/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SERBIA_CRISIS_LINES } from './crisis-lines';

export type CrisisAudience = 'employee' | 'expert';

export interface CrisisBlockProps {
  /** The expert also sees the emergency guidance (UX-17). */
  audience?: CrisisAudience;
  /** Hide the title when a sheet or dialog already shows it. */
  showTitle?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * Crisis resources: Serbian hotlines, the platform disclaimer and, for the
 * expert, emergency guidance. The one block shared by calls and wellbeing
 * check-ins (CW-R-52).
 */
export function CrisisBlock({ audience = 'employee', showTitle = true, headingLevel = 2, className }: CrisisBlockProps) {
  const { t } = useTranslation('calls');
  const titleId = useId();
  const SubHeading = headingLevel === 2 ? 'h3' : 'h4';
  return (
    <section aria-labelledby={showTitle ? titleId : undefined} aria-label={showTitle ? undefined : t('crisis.title')} className={cn('gap-5 flex flex-col', className)}>
      {showTitle ? (
        <Heading level={headingLevel} typeRole="sectionTitle" id={titleId}>
          {t('crisis.title')}
        </Heading>
      ) : null}
      <Text>{t('crisis.body')}</Text>
      <div className="gap-2 flex flex-col">
        <SubHeading className="type-label text-text">{t('crisis.country.serbia')}</SubHeading>
        <ul className="gap-2 m-0 p-0 flex list-none flex-col">
          {SERBIA_CRISIS_LINES.map((line) => {
            const name = t(`crisis.lines.${line.id}`);
            return (
              <li key={line.id} className="gap-x-3 gap-y-1 flex flex-wrap items-center justify-between rounded-control bg-danger-surface px-4 py-2">
                <span className="type-label text-text">{name}</span>
                <a
                  href={`tel:${line.number.replace(/\s/g, '')}`}
                  aria-label={t('crisis.callLabel', { name, number: line.number })}
                  className={cn(
                    'gap-2 min-h-11 px-2 inline-flex items-center rounded-control type-body font-[var(--font-weight-label)] whitespace-nowrap text-danger underline',
                    'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
                  )}
                >
                  <Phone size={18} weight="bold" aria-hidden />
                  {line.number}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      <Text tone="secondary" typeRole="metadata">
        {t('crisis.disclaimer')}
      </Text>
      {audience === 'expert' ? (
        <div className="gap-2 p-4 flex flex-col rounded-control border border-border-subtle bg-canvas">
          <SubHeading className="type-label text-text">{t('crisis.expertTitle')}</SubHeading>
          <ol className="gap-1 pl-5 m-0 flex list-decimal flex-col type-body text-text">
            <li>{t('crisis.expertSteps.stay')}</li>
            <li>{t('crisis.expertSteps.locate')}</li>
            <li>{t('crisis.expertSteps.call')}</li>
          </ol>
        </div>
      ) : null}
    </section>
  );
}

export interface CrisisResourcesButtonProps {
  audience?: CrisisAudience;
  /** Edge the sheet slides in from. */
  side?: SheetSide;
  /** Icon only, for the compact in-call header at mobile width. */
  compact?: boolean;
  className?: string;
}

/**
 * The persistent "Crisis resources" control, one tap away during a call
 * (CALL-12). It opens the crisis block in an animated sheet; the call keeps
 * running and nothing is muted.
 */
export function CrisisResourcesButton({ audience = 'employee', side = 'bottom', compact = false, className }: CrisisResourcesButtonProps) {
  const { t } = useTranslation('calls');
  return (
    <Sheet>
      <SheetTrigger>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Lifebuoy size={18} weight="bold" />}
          aria-label={compact ? t('crisis.open') : undefined}
          className={className}
        >
          <span className={cn(compact && 'sr-only')}>{t('crisis.open')}</span>
        </Button>
      </SheetTrigger>
      <SheetContent title={t('crisis.title')} closeLabel={t('crisis.close')} side={side}>
        <CrisisBlock audience={audience} showTitle={false} />
      </SheetContent>
    </Sheet>
  );
}

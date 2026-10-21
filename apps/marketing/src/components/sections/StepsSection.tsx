import { Eyebrow, Heading, Text, PhotoFigure } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';
import { SECTION_PADDING } from './section';

export interface StepsSectionStep {
  title: string;
  body: string;
}

export interface StepsSectionPhoto {
  key: PhotoKey;
  alt: string;
}

export interface StepsSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: string;
  photo?: StepsSectionPhoto;
  steps: StepsSectionStep[];
  className?: string;
}

export function StepsSection({
  id,
  eyebrow,
  title,
  lead,
  photo,
  steps,
  className,
}: StepsSectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  const useEditorial = steps.length >= 4 || !!photo;

  return (
    <section id={id} aria-labelledby={headingId} className={cn(SECTION_PADDING, className)}>
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-16 gap-y-8 items-start @max-[760px]:grid-cols-1">
        {/* Left column */}
        <div className="@min-[760px]:sticky @min-[760px]:top-24">
          {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
          <Heading
            level={2}
            id={headingId}
            typeRole={useEditorial ? 'editorial' : undefined}
          >
            {title}
          </Heading>
          {lead && (
            <Text typeRole="bodyLarge" tone="secondary" className="mt-3">
              {lead}
            </Text>
          )}
          {photo && (
            <PhotoFigure
              photo={photo.key}
              alt={photo.alt}
              imageRole="card"
              sizes="(max-width: 760px) 100vw, 40vw"
              className="mt-6 overflow-hidden rounded-card"
            />
          )}
        </div>

        {/* Right column */}
        <ol role="list" className="relative">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li
                key={i}
                className={cn(
                  'relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-5 @max-[760px]:grid-cols-[2.25rem_minmax(0,1fr)] @max-[760px]:gap-x-4',
                  !isLast && 'pb-10 @max-[760px]:pb-8',
                )}
              >
                {/* Connector line */}
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className="absolute left-[1.375rem] @max-[760px]:left-[1.125rem] top-11 @max-[760px]:top-9 bottom-0 w-px bg-border-control"
                  />
                )}
                {/* Marker */}
                <span
                  aria-hidden="true"
                  className="w-11 h-11 @max-[760px]:w-9 @max-[760px]:h-9 rounded-full bg-primary text-on-primary type-label grid place-items-center tabular-nums"
                >
                  {i + 1}
                </span>
                {/* Content */}
                <div>
                  <Heading
                    level={3}
                    typeRole="sectionTitle"
                    className="pt-2 @max-[760px]:pt-1.5"
                  >
                    {step.title}
                  </Heading>
                  <Text tone="secondary" className="mt-2 max-w-[60ch]">
                    {step.body}
                  </Text>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

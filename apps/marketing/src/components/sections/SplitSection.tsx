import { Eyebrow, Heading, Text, LinkButton, PhotoFigure } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';

export interface SplitSectionCta {
  label: string;
  href: string;
}

export interface SplitSectionPhoto {
  key: PhotoKey;
  alt: string;
}

export interface SplitSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  photo: SplitSectionPhoto;
  reverse?: boolean;
  cta?: SplitSectionCta;
  className?: string;
}

export function SplitSection({
  id,
  eyebrow,
  title,
  paragraphs,
  bullets,
  photo,
  reverse,
  cta,
  className,
}: SplitSectionProps) {
  const headingId = id ? `${id}-title` : undefined;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'grid gap-12 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center py-16 @max-[760px]:grid-cols-1',
        className,
      )}
    >
      <div className={cn('flex flex-col gap-4', reverse && 'order-2 @max-[760px]:order-none')}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Heading level={2} id={headingId}>
          {title}
        </Heading>
        {paragraphs.map((p, i) => (
          <Text key={i} tone="secondary">
            {p}
          </Text>
        ))}
        {bullets && bullets.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2 pl-5 list-disc">
            {bullets.map((b, i) => (
              <li key={i} className="type-body text-text-secondary">
                {b}
              </li>
            ))}
          </ul>
        )}
        {cta && (
          <div className="mt-4">
            <LinkButton href={cta.href}>{cta.label}</LinkButton>
          </div>
        )}
      </div>
      <PhotoFigure
        photo={photo.key}
        alt={photo.alt}
        imageRole="card"
        sizes="(max-width: 760px) 100vw, 50vw"
        className={cn(
          'overflow-hidden rounded-card',
          reverse && 'order-1 @max-[760px]:order-none',
        )}
      />
    </section>
  );
}

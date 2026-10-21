import { Eyebrow, Text, LinkButton } from '@nestself/ui';
import { PhotoFigure } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';
import { cn } from '@nestself/ui';
import { HERO_PADDING } from './section';

export interface PageHeroPhoto {
  key: PhotoKey;
  alt: string;
}

export interface PageHeroCta {
  label: string;
  href: string;
}

export interface PageHeroProps {
  eyebrow?: string;
  title: string;
  lead: string;
  primaryCta?: PageHeroCta;
  secondaryCta?: PageHeroCta;
  photo?: PageHeroPhoto;
  /** Collage variant shows one large photo plus two small ones. */
  photos?: [PageHeroPhoto, PageHeroPhoto, PageHeroPhoto];
  variant: 'split' | 'stacked' | 'quiet' | 'collage';
  className?: string;
}

export function PageHero({
  eyebrow,
  title,
  lead,
  primaryCta,
  secondaryCta,
  photo,
  photos,
  variant,
  className,
}: PageHeroProps) {
  const isSplit = variant === 'split' || variant === 'collage';
  const hasCtas = (primaryCta && primaryCta.label) || (secondaryCta && secondaryCta.label);

  return (
    <section
      aria-labelledby="page-hero-title"
      className={cn(
        HERO_PADDING,
        isSplit &&
          'grid gap-12 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @max-[760px]:grid-cols-1',
        variant === 'stacked' && 'text-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-6',
          isSplit && 'justify-center',
          variant === 'stacked' && 'mx-auto max-w-[640px] items-center',
          variant === 'quiet' && 'max-w-[720px]',
        )}
      >
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 id="page-hero-title" className="type-marketing-hero text-balance">
          {title}
        </h1>
        <Text typeRole="bodyLarge" tone="secondary">
          {lead}
        </Text>
        {hasCtas && (
          <div className="flex flex-wrap gap-4 @max-[760px]:flex-col @max-[760px]:[&>*]:w-full">
            {primaryCta && primaryCta.label && (
              <LinkButton href={primaryCta.href}>{primaryCta.label}</LinkButton>
            )}
            {secondaryCta && (
              <LinkButton href={secondaryCta.href} variant="secondary">
                {secondaryCta.label}
              </LinkButton>
            )}
          </div>
        )}
      </div>

      {variant === 'split' && photo && (
        <PhotoFigure
          photo={photo.key}
          alt={photo.alt}
          imageRole="hero-3x2"
          sizes="(max-width: 760px) 100vw, 58vw"
          priority
          className="overflow-hidden rounded-card"
        />
      )}

      {variant === 'collage' && photos && (
        <div className="grid grid-cols-2 gap-4 @max-[760px]:gap-3">
          <PhotoFigure
            photo={photos[0].key}
            alt={photos[0].alt}
            imageRole="hero-3x2"
            sizes="(max-width: 760px) 100vw, 58vw"
            priority
            className="col-span-2 overflow-hidden rounded-card @max-[760px]:aspect-[1.2]"
          />
          <PhotoFigure
            photo={photos[1].key}
            alt={photos[1].alt}
            sizes="(max-width: 760px) 50vw, 29vw"
            className="aspect-[1.35] overflow-hidden rounded-card"
          />
          <PhotoFigure
            photo={photos[2].key}
            alt={photos[2].alt}
            sizes="(max-width: 760px) 50vw, 29vw"
            className="aspect-[1.35] overflow-hidden rounded-card"
          />
        </div>
      )}
    </section>
  );
}

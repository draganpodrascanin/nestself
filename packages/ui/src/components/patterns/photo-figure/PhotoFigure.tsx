import type { ReactNode } from 'react';
import {
  photoByKey,
  srcSet,
  cropPath,
  CROP_SPECS,
  focalObjectPosition,
} from '@nestself/assets';
import type { PhotoKey, ImageRole } from '@nestself/assets';
import { cn } from '../../../lib/cn';

export interface PhotoFigureCredit {
  author: string;
  href: string;
  /** Translated prefix shown before the author name (e.g. "Photo by"). */
  photoBy: string;
}

export interface PhotoFigureProps {
  photo: PhotoKey;
  alt: string;
  /** The image crop role from the design system. Named imageRole to avoid colliding with the HTML role attribute. */
  imageRole?: ImageRole;
  sizes: string;
  priority?: boolean;
  decorative?: boolean;
  caption?: ReactNode;
  credit?: PhotoFigureCredit;
  className?: string;
}

export function PhotoFigure({
  photo,
  alt,
  imageRole,
  sizes,
  priority,
  decorative,
  caption,
  credit,
  className,
}: PhotoFigureProps) {
  const photoData = photoByKey[photo];
  const imgWidth = imageRole ? CROP_SPECS[imageRole].width : photoData.width;
  const imgHeight = imageRole ? CROP_SPECS[imageRole].height : photoData.height;
  const objectPosition = focalObjectPosition(photo);

  const resolvedAlt = decorative ? '' : alt;

  const renderSources = () => {
    if (imageRole) {
      return (
        <>
          <source type="image/avif" srcSet={cropPath(photo, imageRole, 'avif')} />
          <source type="image/webp" srcSet={cropPath(photo, imageRole, 'webp')} />
        </>
      );
    }
    return (
      <>
        <source type="image/avif" srcSet={srcSet(photo, 'avif')} sizes={sizes} />
        <source type="image/webp" srcSet={srcSet(photo, 'webp')} sizes={sizes} />
      </>
    );
  };

  return (
    <figure className={cn(className)} aria-hidden={decorative && !caption ? true : undefined}>
      <picture>
        {renderSources()}
        <img
          src={imageRole ? cropPath(photo, imageRole, 'jpg') : undefined}
          srcSet={imageRole ? undefined : srcSet(photo, 'jpg')}
          sizes={imageRole ? undefined : sizes}
          alt={resolvedAlt}
          width={imgWidth}
          height={imgHeight}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          style={{ objectPosition }}
          className="object-cover"
        />
      </picture>
      {caption || credit ? (
        <figcaption className="mt-3 type-metadata text-text-secondary">
          {caption}
          {credit ? (
            <span className={cn('type-metadata text-text-secondary', caption && 'block mt-1')}>
              {credit.photoBy}{' '}
              <a
                href={credit.href}
                className="text-primary underline underline-offset-[0.2em]"
                target="_blank"
                rel="noopener noreferrer"
              >
                {credit.author}
              </a>
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

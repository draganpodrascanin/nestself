import { PhotoFigure } from '@nestself/ui';
import type { PhotoKey } from '@nestself/assets';
import { photoByKey } from '@nestself/assets';

export interface FigureProps {
  photo: string;
  alt: string;
  caption?: string;
}

export function Figure({ photo, alt, caption }: FigureProps) {
  if (!(photo in photoByKey)) {
    throw new Error(`Unknown photo key: "${photo}". Valid keys: ${Object.keys(photoByKey).join(', ')}`);
  }
  const key = photo as PhotoKey;
  return (
    <PhotoFigure
      photo={key}
      alt={alt}
      sizes="(min-width: 1024px) 720px, 100vw"
      caption={caption}
      className="my-8"
    />
  );
}

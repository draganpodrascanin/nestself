/**
 * Media block components: ContentImage, ApprovedMedia, AudioPlayer,
 * VideoPlayer, TranscriptPanel.
 *
 * Media contract (item 1): each media block validates its asset id against
 * the `media` record. A block whose asset is missing renders nothing.
 * Image uses `<picture>` with `detail_webp` source and `detail_jpeg`
 * fallback, plus `width`/`height` and `object-position` from the focal point.
 *
 * Captions track and speed controls are T-C2.09 scope. The
 * `media-has-caption` eslint disable is because captions are a separate
 * feature (T-C2.09), not because the transcript block provides them.
 */
import { Accordion, AccordionItem } from '@nestself/ui';
import { useState, useCallback } from 'react';

import { ContentIdSchema } from '../schema/blocks.ts';

import type { RenderContext } from './context.ts';
import { ContentParagraph } from './text-blocks.tsx';
import { isSafeAppHref } from './safe-href.ts';

// ---------------------------------------------------------------------------
// Shared raw-node shape
// ---------------------------------------------------------------------------

interface RawNode {
  type: string;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: RawNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate mediaAssetId before using it (item 5). */
function validAssetId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return ContentIdSchema.safeParse(raw).success ? raw : null;
}

/** Focal-point to CSS object-position. */
function focalPosition(fp?: { x: number; y: number }): string | undefined {
  if (!fp) return undefined;
  return `${(fp.x * 100).toFixed(1)}% ${(fp.y * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// ContentImage — <picture> with webp/jpeg fallback (item 1)
// ---------------------------------------------------------------------------

export function ContentImage({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  // Hooks must be called unconditionally (rules of hooks)
  const [imgError, setImgError] = useState(false);
  const onError = useCallback(() => setImgError(true), []);

  const assetId = validAssetId(node.attrs?.mediaAssetId);
  const meta = assetId ? ctx.media[assetId] : undefined;
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
  const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : null;
  const hasWebp = meta?.renditions.includes('detail_webp') ?? false;
  const hasJpeg = meta?.renditions.includes('detail_jpeg') ?? false;

  if (!assetId || !meta || (!hasWebp && !hasJpeg)) return null;

  const objectPosition = focalPosition(meta.focalPoint);

  if (imgError) {
    return (
      <figure className="mb-4">
        <div
          className="w-full rounded-card bg-tint flex items-center justify-center py-12 text-text-secondary type-metadata"
          role="img"
          aria-label={alt || ctx.labels.imageUnavailable}
        >
          {ctx.labels.imageUnavailable}
        </div>
        {caption ? (
          <figcaption className="mt-2 text-text-secondary type-metadata text-center">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <figure className="mb-4">
      <picture>
        {hasWebp ? (
          <source
            srcSet={ctx.mediaUrl(assetId, 'detail_webp')}
            type="image/webp"
          />
        ) : null}
        <img
          src={ctx.mediaUrl(assetId, hasJpeg ? 'detail_jpeg' : 'detail_webp')}
          alt={alt}
          loading="lazy"
          width={meta.width}
          height={meta.height}
          onError={onError}
          className="w-full rounded-card"
          style={objectPosition ? { objectPosition, objectFit: 'cover' } : undefined}
        />
      </picture>
      {caption ? (
        <figcaption className="mt-2 text-text-secondary type-metadata text-center">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// ApprovedMedia — audio, video, pdf
// ---------------------------------------------------------------------------

export function ApprovedMedia({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const assetId = validAssetId(node.attrs?.mediaAssetId);
  if (!assetId) return null;

  const meta = ctx.media[assetId];
  if (!meta) return null;

  const kind = typeof node.attrs?.kind === 'string' ? node.attrs.kind : '';
  const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : null;

  if (kind === 'audio' && meta.renditions.includes('audio')) {
    return (
      <div className="mb-4">
        <AudioPlayer src={ctx.mediaUrl(assetId, 'audio')} caption={caption} />
      </div>
    );
  }

  if (kind === 'video') {
    const hasVideo = meta.renditions.includes('video');
    if (!hasVideo) return null;
    const poster = meta.renditions.includes('poster_webp')
      ? ctx.mediaUrl(assetId, 'poster_webp')
      : undefined;
    return (
      <div className="mb-4">
        <VideoPlayer src={ctx.mediaUrl(assetId, 'video')} poster={poster} caption={caption} />
      </div>
    );
  }

  if (kind === 'pdf' && meta.renditions.includes('pdf')) {
    const href = ctx.mediaUrl(assetId, 'pdf');
    // Validate the resolved href (item 6)
    if (!isSafeAppHref(href)) return null;
    return (
      <div className="mb-4">
        <a
          href={href}
          download
          className="inline-flex items-center gap-2 text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {/* Inline PDF icon (Phosphor Regular). Migrate to @nestself/ui Icon
              when @phosphor-icons/react is added as a dependency. */}
          <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" className="shrink-0">
            <path d="M224,152a8,8,0,0,1-8,8H192v16h16a8,8,0,0,1,0,16H192v16a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8h32A8,8,0,0,1,224,152ZM92,172a28,28,0,0,1-28,28H56v8a8,8,0,0,1-16,0V152a8,8,0,0,1,8-8H64A28,28,0,0,1,92,172Zm-16,0a12,12,0,0,0-12-12H56v24h8A12,12,0,0,0,76,172Zm88,0a36,36,0,0,1-36,36H112a8,8,0,0,1-8-8V152a8,8,0,0,1,8-8h16A36,36,0,0,1,164,172Zm-16,0a20,20,0,0,0-20-20h-8v40h8A20,20,0,0,0,148,172ZM40,112V40A16,16,0,0,1,56,24h96a8,8,0,0,1,5.66,2.34l56,56A8,8,0,0,1,216,88v24a8,8,0,0,1-16,0V96H152a8,8,0,0,1-8-8V40H56v72a8,8,0,0,1-16,0ZM160,80h28.69L160,51.31Z" />
          </svg>
          {caption ?? ctx.labels.downloadPdf}
        </a>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// AudioPlayer (FMT-R-25: no autoplay)
// ---------------------------------------------------------------------------

function AudioPlayer({ src, caption }: { src: string; caption?: string | null }) {
  return (
    <figure>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions track is T-C2.09 scope, not provided by the transcript block */}
      <audio
        controls
        preload="metadata"
        src={src}
        className="w-full"
      />
      {caption ? (
        <figcaption className="mt-1 text-text-secondary type-metadata">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// VideoPlayer (FMT-R-25: no autoplay)
// ---------------------------------------------------------------------------

function VideoPlayer({
  src,
  poster,
  caption,
}: {
  src: string;
  poster?: string;
  caption?: string | null;
}) {
  return (
    <figure>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- captions track is T-C2.09 scope, not provided by the transcript block */}
      <video
        controls
        preload="metadata"
        src={src}
        poster={poster}
        className="w-full rounded-card"
      />
      {caption ? (
        <figcaption className="mt-1 text-text-secondary type-metadata">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// TranscriptPanel (item 15: hiddenUntilFound, heading follows offset)
// ---------------------------------------------------------------------------

export function TranscriptPanel({ node, ctx }: { node: RawNode; ctx: RenderContext }) {
  const mediaAssetId = typeof node.attrs?.mediaAssetId === 'string'
    ? node.attrs.mediaAssetId
    : 'transcript';

  // Transcript trigger heading level follows headingOffset (item 15).
  // Base heading for transcripts is 3 (one below typical section heading of 2).
  const offset = Math.max(0, ctx.headingOffset);
  const headingLevel = Math.min(3 + offset, 6) as 2 | 3 | 4 | 5 | 6;

  return (
    <Accordion className="mb-4 border border-border-subtle rounded-card">
      <AccordionItem
        value={`transcript-${mediaAssetId}`}
        title={ctx.labels.transcript}
        headingLevel={headingLevel <= 4 ? headingLevel as 2 | 3 | 4 : undefined}
        hiddenUntilFound
      >
        <div className="text-text-secondary type-body">
          {node.content?.map((child, i) => (
            <ContentParagraph key={i} node={child} ctx={ctx} />
          ))}
        </div>
      </AccordionItem>
    </Accordion>
  );
}

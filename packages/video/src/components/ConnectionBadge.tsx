import { CircleNotch, WifiHigh, WifiLow, WifiMedium } from '@phosphor-icons/react/dist/ssr';
import { AnimatePresence, LiveRegion, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';
import { useTranslation } from 'react-i18next';
import type { ConnectionQuality } from '../quality-thresholds';

export interface ConnectionBadgeProps {
  /** Three-state quality from the 30-second aggregate (`useConnectionQuality`). */
  quality: ConnectionQuality;
  /** The connection dropped and the SDK is reconnecting (CALL-10). */
  reconnecting?: boolean;
  /** Degraded mode paused outgoing video (CALL-09). */
  videoPaused?: boolean;
  className?: string;
}

const ICON = { good: WifiHigh, degraded: WifiMedium, poor: WifiLow } as const;

/** Colour and icon both change, so the state never rests on colour alone. */
const TONE: Record<ConnectionQuality, string> = {
  good: 'bg-success-surface text-success',
  degraded: 'bg-warning-surface text-warning',
  poor: 'bg-danger-surface text-danger',
};

type Banner = 'reconnecting' | 'videoPaused' | 'poorBanner' | 'degradedBanner';

/**
 * Connection badge with three states and a banner that explains what the
 * call is doing about it (UX-12, UX-38). Both sit in a polite live region,
 * so a change is announced (CW-R-54); the banner animates in and out.
 */
export function ConnectionBadge({ quality, reconnecting = false, videoPaused = false, className }: ConnectionBadgeProps) {
  const { t } = useTranslation('calls');
  const bannerMotion = useMotionPreset('popover');
  const level: ConnectionQuality = reconnecting ? 'poor' : quality;
  const banner: Banner | null = reconnecting
    ? 'reconnecting'
    : videoPaused
      ? 'videoPaused'
      : quality === 'poor'
        ? 'poorBanner'
        : quality === 'degraded'
          ? 'degradedBanner'
          : null;
  const Icon = ICON[level];

  return (
    <div className={cn('gap-2 flex flex-col items-start', className)}>
      <LiveRegion politeness="polite">
        <div className="gap-2 flex flex-col items-start">
          <span
            data-testid="connection-badge"
            data-quality={level}
            className={cn(
              'gap-1.5 px-3 py-1 inline-flex items-center rounded-pill type-metadata font-[var(--font-weight-label)]',
              'transition-colors duration-[var(--motion-fast)] ease-standard',
              TONE[level],
            )}
          >
            <Icon size={16} weight="bold" aria-hidden />
            {t(`connection.${level}`)}
          </span>
          <MotionFeatures>
            <AnimatePresence mode="wait">
              {banner ? (
                <m.p
                  key={banner}
                  {...bannerMotion}
                  className={cn(
                    'gap-2 px-3 py-2 flex max-w-80 items-start rounded-control bg-surface text-text shadow-menu type-metadata origin-top-left',
                  )}
                >
                  {banner === 'reconnecting' ? (
                    <CircleNotch size={16} className="mt-0.5 shrink-0 motion-safe:animate-spin" aria-hidden />
                  ) : null}
                  <span>{t(`connection.${banner}`)}</span>
                </m.p>
              ) : null}
            </AnimatePresence>
          </MotionFeatures>
        </div>
      </LiveRegion>
    </div>
  );
}

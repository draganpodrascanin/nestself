import {
  Check,
  CornersIn,
  CornersOut,
  DotsThree,
  Ear,
  EyeSlash,
  GearSix,
  Microphone,
  MicrophoneSlash,
  MonitorArrowUp,
  PhoneDisconnect,
  PhoneX,
  Sparkle,
  VideoCamera,
  VideoCameraSlash,
} from '@phosphor-icons/react/dist/ssr';
import type { CallParticipantRole } from '@nestself/contracts';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTrigger,
  AnimatePresence,
  Button,
  LiveRegion,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  MotionFeatures,
  VisuallyHidden,
  cn,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { Fragment, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { BlurState, CallSignal, DeviceKind, DevicesState } from '../types';
import { deviceLabel } from './device-label';

/** From this width every control sits inline; below it secondary controls collapse into "More" (UX-20). */
export const CONTROL_BAR_WIDE_QUERY = '(min-width: 72rem)';

export interface ControlBarProps {
  participantRole: CallParticipantRole;
  muted: boolean;
  cameraOn: boolean;
  blur: BlurState;
  sharingScreen?: boolean;
  fullscreen?: boolean;
  /** Webinar attendees have a microphone only when given the floor. Defaults to true for everyone else. */
  microphoneAvailable?: boolean;
  devices?: Pick<DevicesState, 'cameras' | 'microphones' | 'speakers' | 'selected'>;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleBlur?: () => void;
  onSelectDevice?: (kind: DeviceKind, deviceId: string) => void;
  onToggleFullscreen?: () => void;
  /** Expert only (CALL-22). */
  onToggleScreenShare?: () => void;
  /** "I cannot hear you" and "I cannot see you" (UX-14); sending is wired by the app. */
  onSignal?: (signal: CallSignal) => void;
  onLeave: () => void;
  /** Expert only: confirm, then end the call for both (UX-16). */
  onEndForEveryone?: () => void;
  /** Ending for everyone is in flight. */
  endPending?: boolean;
  /** A failed control action (signal, end for everyone), already translated. */
  error?: string | null;
  className?: string;
}

const CONTROL =
  'min-h-11 min-w-11 px-2 py-1 pointer-coarse:min-h-12 pointer-coarse:min-w-12';
const CONTROL_WIDE = 'min-w-20';

interface ControlButtonProps {
  label: string;
  icon: ReactNode;
  wide: boolean;
  onClick?: () => void;
  danger?: boolean;
  /** Draws the "off" state (muted, camera off) in the danger colour; the label says it too. */
  off?: boolean;
  disabled?: boolean;
  description?: string;
}

function ControlButton({ label, icon, wide, onClick, danger, off, disabled, description }: ControlButtonProps) {
  const descriptionId = useId();
  return (
    <>
      <Button
        variant={danger ? 'danger' : 'secondary'}
        size="sm"
        onClick={onClick}
        disabled={disabled}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(CONTROL, wide && CONTROL_WIDE, off && 'text-danger')}
      >
        <span className="gap-0.5 flex flex-col items-center">
          <span aria-hidden className="inline-flex">
            {icon}
          </span>
          <span className={cn(wide ? 'type-metadata' : 'sr-only')}>{label}</span>
        </span>
      </Button>
      {description ? (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      ) : null}
    </>
  );
}

function TriggerContent({ icon, label, wide }: { icon: ReactNode; label: string; wide: boolean }) {
  return (
    <span className="gap-0.5 flex flex-col items-center">
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
      <span className={cn(wide ? 'type-metadata' : 'sr-only')}>{label}</span>
    </span>
  );
}

const TRIGGER = cn(CONTROL, 'border-border-control bg-surface text-primary hover:bg-tint font-[var(--font-weight-label)]');

/**
 * Call controls (D-CW-22, UX-22): mute, camera, blur, device switch,
 * fullscreen, quick signals, leave and, for the expert, screen sharing and
 * "end for everyone". 44 px targets; below `CONTROL_BAR_WIDE_QUERY` the
 * secondary controls collapse into an animated overflow menu. Webinar
 * attendees never get a camera control (D-CW-35). State changes are
 * announced in a polite live region (CW-R-54).
 */
export function ControlBar({
  participantRole,
  muted,
  cameraOn,
  blur,
  sharingScreen = false,
  fullscreen = false,
  microphoneAvailable,
  devices,
  onToggleMute,
  onToggleCamera,
  onToggleBlur,
  onSelectDevice,
  onToggleFullscreen,
  onToggleScreenShare,
  onSignal,
  onLeave,
  onEndForEveryone,
  endPending = false,
  error,
  className,
}: ControlBarProps) {
  const { t } = useTranslation('calls');
  const wide = useMediaQuery(CONTROL_BAR_WIDE_QUERY);
  const noticeMotion = useMotionPreset('popover');

  const isAttendee = participantRole === 'attendee';
  const isExpert = participantRole === 'expert';
  const canUseCamera = !isAttendee;
  const canUseMicrophone = microphoneAvailable ?? !isAttendee;
  const showBlur = canUseCamera && !!onToggleBlur;
  const blurUnavailable = blur.supported === false;
  const showShare = isExpert && !!onToggleScreenShare;
  const showFullscreen = !!onToggleFullscreen;
  const showSignals = !isAttendee && !!onSignal;

  // Announce state changes (adjusting state while rendering, not in an effect).
  const current = { muted, cameraOn, blur: blur.enabled, sharing: sharingScreen };
  const [previous, setPrevious] = useState(current);
  const [announcement, setAnnouncement] = useState('');
  if (
    previous.muted !== current.muted ||
    previous.cameraOn !== current.cameraOn ||
    previous.blur !== current.blur ||
    previous.sharing !== current.sharing
  ) {
    const message =
      previous.muted !== current.muted
        ? t(muted ? 'controls.announce.muted' : 'controls.announce.unmuted')
        : previous.cameraOn !== current.cameraOn
          ? t(cameraOn ? 'controls.announce.cameraOn' : 'controls.announce.cameraOff')
          : previous.blur !== current.blur
            ? t(blur.enabled ? 'controls.announce.blurOn' : 'controls.announce.blurOff')
            : t(sharingScreen ? 'controls.announce.sharingStarted' : 'controls.announce.sharingStopped');
    setPrevious(current);
    setAnnouncement(message);
  }

  const deviceGroups: Array<{ kind: DeviceKind; title: string; list: DevicesState['cameras'] }> = devices
    ? [
        ...(canUseCamera ? [{ kind: 'camera' as const, title: t('controls.camera'), list: devices.cameras }] : []),
        ...(canUseMicrophone ? [{ kind: 'microphone' as const, title: t('controls.microphone'), list: devices.microphones }] : []),
        { kind: 'speaker' as const, title: t('controls.speaker'), list: devices.speakers },
      ].filter((group) => group.list.length > 0)
    : [];

  const blurLabel = blur.enabled ? t('controls.blurOff') : t('controls.blurOn');
  const shareLabel = sharingScreen ? t('controls.stopSharing') : t('controls.shareScreen');
  const fullscreenLabel = fullscreen ? t('controls.exitFullscreen') : t('controls.fullscreen');
  const overflowItems = !wide && (showBlur || showShare || showFullscreen || showSignals);

  return (
    <div className={cn('gap-2 flex flex-col items-center', className)}>
      <MotionFeatures>
        <AnimatePresence>
          {error ? (
            <m.div key="error" {...noticeMotion} className="w-full max-w-xl origin-bottom">
              <Alert tone="danger">{error}</Alert>
            </m.div>
          ) : null}
          {sharingScreen ? (
            <m.p
              key="sharing"
              {...noticeMotion}
              className="gap-2 px-3 py-1 inline-flex items-center rounded-pill bg-info-surface text-info type-metadata font-[var(--font-weight-label)] origin-bottom"
            >
              <MonitorArrowUp size={16} aria-hidden />
              {t('controls.sharingIndicator')}
            </m.p>
          ) : null}
        </AnimatePresence>
      </MotionFeatures>

      <div
        role="group"
        aria-label={t('controls.label')}
        className="gap-2 p-2 flex max-w-full flex-wrap items-center justify-center rounded-card bg-raised shadow-menu"
      >
        {canUseMicrophone ? (
          <ControlButton
            wide={wide}
            label={muted ? t('controls.unmute') : t('controls.mute')}
            icon={muted ? <MicrophoneSlash size={22} weight="bold" /> : <Microphone size={22} weight="bold" />}
            off={muted}
            onClick={onToggleMute}
          />
        ) : null}
        {canUseCamera ? (
          <ControlButton
            wide={wide}
            label={cameraOn ? t('controls.cameraOff') : t('controls.cameraOn')}
            icon={cameraOn ? <VideoCamera size={22} weight="bold" /> : <VideoCameraSlash size={22} weight="bold" />}
            off={!cameraOn}
            onClick={onToggleCamera}
          />
        ) : null}
        {wide && showBlur ? (
          <ControlButton
            wide={wide}
            label={blurLabel}
            icon={<Sparkle size={22} weight={blur.enabled ? 'fill' : 'bold'} />}
            onClick={onToggleBlur}
            disabled={blurUnavailable || blur.loading}
            description={blurUnavailable ? t('controls.blurUnavailable') : undefined}
          />
        ) : null}

        {deviceGroups.length > 0 && onSelectDevice ? (
          <Menu>
            <MenuTrigger className={cn(TRIGGER, wide && CONTROL_WIDE)}>
              <TriggerContent icon={<GearSix size={22} weight="bold" />} label={t('controls.devices')} wide={wide} />
            </MenuTrigger>
            <MenuPopup aria-label={t('controls.devices')} className="max-h-[min(70vh,28rem)] min-w-64 overflow-auto">
              {deviceGroups.map((group) => (
                <Fragment key={group.kind}>
                  <div aria-hidden className="px-3 pt-2 pb-1 type-metadata text-text-secondary">
                    {group.title}
                  </div>
                  {group.list.map((device, index) => {
                    const selected = devices?.selected[group.kind] === device.deviceId;
                    return (
                      <MenuItem
                        key={device.deviceId}
                        onClick={() => onSelectDevice(group.kind, device.deviceId)}
                        className="gap-3 justify-between"
                      >
                        <span>
                          <VisuallyHidden>{`${group.title}: `}</VisuallyHidden>
                          {deviceLabel(t, group.kind, device, index)}
                        </span>
                        {selected ? (
                          <>
                            <Check size={16} aria-hidden />
                            <VisuallyHidden>{`, ${t('controls.selected')}`}</VisuallyHidden>
                          </>
                        ) : null}
                      </MenuItem>
                    );
                  })}
                </Fragment>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}

        {wide && showShare ? (
          <ControlButton wide={wide} label={shareLabel} icon={<MonitorArrowUp size={22} weight="bold" />} onClick={onToggleScreenShare} />
        ) : null}
        {wide && showFullscreen ? (
          <ControlButton
            wide={wide}
            label={fullscreenLabel}
            icon={fullscreen ? <CornersIn size={22} weight="bold" /> : <CornersOut size={22} weight="bold" />}
            onClick={onToggleFullscreen}
          />
        ) : null}
        {wide && showSignals ? (
          <>
            <ControlButton wide={wide} label={t('controls.cannotHear')} icon={<Ear size={22} weight="bold" />} onClick={() => onSignal?.('cannot_hear')} />
            <ControlButton wide={wide} label={t('controls.cannotSee')} icon={<EyeSlash size={22} weight="bold" />} onClick={() => onSignal?.('cannot_see')} />
          </>
        ) : null}

        {overflowItems ? (
          <Menu>
            <MenuTrigger className={TRIGGER}>
              <TriggerContent icon={<DotsThree size={22} weight="bold" />} label={t('controls.more')} wide={wide} />
            </MenuTrigger>
            <MenuPopup aria-label={t('controls.more')} className="min-w-64">
              {showBlur ? (
                <MenuItem onClick={blurUnavailable || blur.loading ? undefined : onToggleBlur} className="gap-3">
                  <Sparkle size={18} aria-hidden />
                  {blurUnavailable ? t('controls.blurUnavailable') : blurLabel}
                </MenuItem>
              ) : null}
              {showShare ? (
                <MenuItem onClick={onToggleScreenShare} className="gap-3">
                  <MonitorArrowUp size={18} aria-hidden />
                  {shareLabel}
                </MenuItem>
              ) : null}
              {showFullscreen ? (
                <MenuItem onClick={onToggleFullscreen} className="gap-3">
                  {fullscreen ? <CornersIn size={18} aria-hidden /> : <CornersOut size={18} aria-hidden />}
                  {fullscreenLabel}
                </MenuItem>
              ) : null}
              {showSignals ? (
                <>
                  <MenuItem onClick={() => onSignal?.('cannot_hear')} className="gap-3">
                    <Ear size={18} aria-hidden />
                    {t('controls.cannotHear')}
                  </MenuItem>
                  <MenuItem onClick={() => onSignal?.('cannot_see')} className="gap-3">
                    <EyeSlash size={18} aria-hidden />
                    {t('controls.cannotSee')}
                  </MenuItem>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}

        <ControlButton
          wide={wide}
          label={t('consultation.leave')}
          icon={<PhoneDisconnect size={22} weight="bold" />}
          danger={!isExpert || !onEndForEveryone}
          onClick={onLeave}
        />
        {isExpert && onEndForEveryone ? (
          <AlertDialog>
            <AlertDialogTrigger>
              <Button variant="danger" size="sm" className={cn(CONTROL, wide && CONTROL_WIDE)}>
                <span className="gap-0.5 flex flex-col items-center">
                  <PhoneX size={22} weight="bold" aria-hidden />
                  <span className={cn(wide ? 'type-metadata' : 'sr-only')}>{t('controls.endForEveryone')}</span>
                </span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              title={t('controls.endConfirmTitle')}
              description={t('controls.endConfirmBody')}
              confirmLabel={t('consultation.end')}
              cancelLabel={t('controls.keepTalking')}
              destructive
              confirmPending={endPending}
              onConfirm={onEndForEveryone}
            />
          </AlertDialog>
        ) : null}
      </div>

      <VisuallyHidden as="div">
        <LiveRegion politeness="polite">
          <span data-testid="control-bar-announcer">{announcement}</span>
        </LiveRegion>
      </VisuallyHidden>
    </div>
  );
}

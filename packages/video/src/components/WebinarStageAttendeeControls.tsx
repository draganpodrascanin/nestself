/**
 * The attendee's controls (WBN-07): the webinar sound, the hand, fullscreen
 * and leave, plus the microphone only while a host has given the floor and
 * only after the floor notice was read (CW-R-125). Attendees never send
 * video (D-CW-35, CW-R-124): this file has no camera control and reads and
 * changes nothing on the controller but the mute.
 */
import { CornersIn, CornersOut, Microphone, MicrophoneSlash, PhoneDisconnect, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react/dist/ssr';
import { AnimatePresence, Button, MotionFeatures, cn, m, useMotionPreset } from '@nestself/ui';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useControllerSlice } from '../hooks/useControllerSlice';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { CallSessionControllerApi } from '../types';
import type { WebinarClientApi } from '../webinar/types';
import { CONTROL_BAR_WIDE_QUERY } from './ControlBar';
import { HandRaiseButton } from './HandRaiseButton';
import { useChangeAnnouncement, useErrorMessages, useMicrophoneBlocked } from './WebinarStageHooks';
import { Announcer, ErrorStack } from './WebinarStageParts';

export interface WebinarStageAttendeeControlsProps {
  controller: CallSessionControllerApi;
  client: WebinarClientApi;
  /** The incoming webinar sound is muted on this device. */
  soundMuted: boolean;
  onToggleSound: () => void;
  fullscreen: { supported: boolean; active: boolean; toggle: () => void };
  onLeave: () => void;
}

const CONTROL = 'min-h-11 min-w-11 px-2 py-1 pointer-coarse:min-h-12 pointer-coarse:min-w-12';

function Control({ label, icon, wide, onClick, danger, off, disabled, describedBy, testId }: {
  label: string;
  icon: ReactNode;
  wide: boolean;
  onClick: () => void;
  danger?: boolean;
  off?: boolean;
  disabled?: boolean;
  describedBy?: string;
  testId?: string;
}) {
  return (
    <Button
      variant={danger ? 'danger' : 'secondary'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
      data-testid={testId}
      className={cn(CONTROL, wide && 'min-w-20', off && 'text-danger')}
    >
      <span className="gap-0.5 flex flex-col items-center">
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
        <span className={cn(wide ? 'type-metadata' : 'sr-only')}>{label}</span>
      </span>
    </Button>
  );
}

export function WebinarStageAttendeeControls({ controller, client, soundMuted, onToggleSound, fullscreen, onLeave }: WebinarStageAttendeeControlsProps) {
  const { t } = useTranslation('calls');
  const wide = useMediaQuery(CONTROL_BAR_WIDE_QUERY);
  const stage = useWebinarStage(client);
  const media = useControllerSlice(controller, 'media');
  const popover = useMotionPreset('popover');
  const lockedId = useId();
  const floor = stage.myFloor.status === 'given';
  const locked = floor && !stage.myFloor.acknowledged;
  const errors = useErrorMessages(null, useMicrophoneBlocked(client, controller), stage.errorOf('floor'));

  const announcement = useChangeAnnouncement(`${floor && !media.muted}|${soundMuted}`, (previous, next) => {
    const [wasTalking, wasSilent] = previous.split('|');
    const [talking, silent] = next.split('|');
    if (wasSilent !== silent) return t(silent === 'true' ? 'webinar.soundMuted' : 'webinar.soundOn');
    if (wasTalking !== talking) return t(talking === 'true' ? 'controls.announce.unmuted' : 'controls.announce.muted');
    return null;
  });

  return (
    <div className="gap-2 flex max-w-full flex-col items-center">
      <MotionFeatures>
        <ErrorStack messages={errors} testId="webinar-controls-error" />
      </MotionFeatures>
      <div role="group" aria-label={t('webinar.controlsLabel')} className="gap-2 p-2 flex max-w-full flex-wrap items-center justify-center rounded-card bg-raised shadow-menu" data-testid="webinar-attendee-controls">
        <MotionFeatures>
          <AnimatePresence initial={false}>
            {floor ? (
              <m.div key="microphone" {...popover} data-testid="webinar-floor-microphone" className="origin-bottom">
                <Control
                  wide={wide}
                  label={media.muted ? t('controls.unmute') : t('controls.mute')}
                  icon={media.muted ? <MicrophoneSlash size={22} weight="bold" /> : <Microphone size={22} weight="bold" />}
                  off={media.muted}
                  disabled={locked}
                  describedBy={locked ? lockedId : undefined}
                  onClick={() => controller.setMuted(!media.muted)}
                />
                <span id={lockedId} className="sr-only">
                  {t('webinar.microphoneLocked')}
                </span>
              </m.div>
            ) : null}
          </AnimatePresence>
        </MotionFeatures>
        <Control
          wide={wide}
          label={soundMuted ? t('webinar.unmuteSound') : t('webinar.muteSound')}
          icon={soundMuted ? <SpeakerSlash size={22} weight="bold" /> : <SpeakerHigh size={22} weight="bold" />}
          off={soundMuted}
          onClick={onToggleSound}
          testId="webinar-sound-toggle"
        />
        <HandRaiseButton client={client} showLabel={wide} />
        {fullscreen.supported ? (
          <Control
            wide={wide}
            label={fullscreen.active ? t('controls.exitFullscreen') : t('controls.fullscreen')}
            icon={fullscreen.active ? <CornersIn size={22} weight="bold" /> : <CornersOut size={22} weight="bold" />}
            onClick={fullscreen.toggle}
          />
        ) : null}
        <Control wide={wide} label={t('consultation.leave')} icon={<PhoneDisconnect size={22} weight="bold" />} danger onClick={onLeave} />
        <Announcer announcement={announcement} testId="webinar-controls-announcer" />
      </div>
    </div>
  );
}

/**
 * Presenters' and the moderator's controls: the existing `ControlBar` with
 * the host's `participantRole` (microphone, camera, blur, devices,
 * fullscreen, leave; its "you are sharing your screen" indicator, WBN-18),
 * screen sharing, which `ControlBar` offers to experts only, and "End
 * webinar for everyone" behind a confirmation (WBN-21, WBN-29). Hosts send
 * on every channel (D-CW-10); this file is never rendered for an attendee.
 */
import { MonitorArrowUp, PhoneX } from '@phosphor-icons/react/dist/ssr';
import type { WebinarHostRole } from '@nestself/contracts';
import { AlertDialog, AlertDialogContent, AlertDialogTrigger, Button } from '@nestself/ui';
import { useTranslation } from 'react-i18next';
import { useCallSession } from '../hooks/useCallSession';
import { useDevices } from '../hooks/useDevices';
import type { CallSessionControllerApi } from '../types';
import { ControlBar } from './ControlBar';

export interface WebinarStageHostControlsProps {
  controller: CallSessionControllerApi;
  role: WebinarHostRole;
  fullscreen: { supported: boolean; active: boolean; toggle: () => void };
  onLeave: () => void;
  /** Ends the webinar for everyone after the confirmation; shown while the webinar is live. */
  onEndForEveryone?: () => void;
  endPending?: boolean;
}

export function WebinarStageHostControls({ controller, role, fullscreen, onLeave, onEndForEveryone, endPending = false }: WebinarStageHostControlsProps) {
  const { t } = useTranslation('calls');
  const call = useCallSession(controller);
  const devices = useDevices(controller);
  const sharing = call.media.sharingScreen;
  return (
    <div className="gap-2 flex flex-col items-center" data-testid="webinar-host-controls">
      <ControlBar
        participantRole={role}
        muted={call.media.muted}
        cameraOn={call.media.cameraOn}
        blur={devices.blur}
        sharingScreen={sharing}
        fullscreen={fullscreen.active}
        devices={devices}
        onToggleMute={call.toggleMute}
        onToggleCamera={() => void call.toggleCamera()}
        onToggleBlur={() => void devices.setBlur(!devices.blur.enabled)}
        onSelectDevice={(kind, deviceId) => void devices.selectDevice(kind, deviceId)}
        onToggleFullscreen={fullscreen.supported ? fullscreen.toggle : undefined}
        onLeave={onLeave}
      />
      <div className="gap-2 flex flex-wrap justify-center">
        <Button
          size="sm"
          variant={sharing ? 'primary' : 'secondary'}
          leadingIcon={<MonitorArrowUp size={20} weight="bold" />}
          data-testid="webinar-share-screen"
          // A cancelled screen picker is not an error; the controller reports real failures in its state.
          onClick={() => void call.toggleScreenShare().catch(() => undefined)}
        >
          {sharing ? t('controls.stopSharing') : t('controls.shareScreen')}
        </Button>
        {onEndForEveryone ? (
          <AlertDialog>
            <AlertDialogTrigger>
              <Button size="sm" variant="danger" leadingIcon={<PhoneX size={20} weight="bold" />} loading={endPending} loadingLabel={t('webinar.ending')} data-testid="webinar-end">
                {t('webinar.endForEveryone')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent
              title={t('webinar.endConfirmTitle')}
              description={t('webinar.endConfirmBody')}
              confirmLabel={t('webinar.endForEveryone')}
              cancelLabel={t('webinar.keepGoing')}
              destructive
              confirmPending={endPending}
              onConfirm={onEndForEveryone}
            >
              <span hidden data-testid="webinar-end-dialog" />
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}

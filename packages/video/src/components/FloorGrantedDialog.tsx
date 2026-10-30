import { Microphone, Record } from '@phosphor-icons/react/dist/ssr';
import {
  Alert,
  AnimatePresence,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  MotionFeatures,
  cn,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { useTranslation } from 'react-i18next';
import { useWebinarStage } from '../hooks/useWebinarStage';
import type { CallSessionControllerApi } from '../types';
import type { WebinarClientApi } from '../webinar/types';
import { ErrorStack } from './WebinarStageParts';
import { useErrorMessages, useMicrophoneBlocked } from './WebinarStageHooks';

export interface FloorGrantedDialogProps {
  /** The attendee's webinar client; the dialog opens on `webinar.floor.given` for this participant. */
  client: WebinarClientApi;
  /**
   * "Unmute now" unmutes through the call controller, and a blocked
   * microphone is read from its devices state. The floor is audio only;
   * nothing here touches video.
   */
  controller: Pick<CallSessionControllerApi, 'setMuted' | 'getSnapshot' | 'subscribe'>;
  /** A failure from outside, already translated. */
  error?: string | null;
}

/**
 * "You can speak now. Unmute to talk." with the notice that the attendee's
 * voice is part of the recording and the camera stays off (CW-R-125, D-CW-34,
 * D-CW-35). Opens when a host gives this attendee the floor; the attendee
 * stays muted until they choose "Unmute now". Closing it in any way counts as
 * having read it and enables the microphone control; it does not lower the
 * hand. Animated with the dialog preset.
 */
export function FloorGrantedDialog({ client, controller, error }: FloorGrantedDialogProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const open = stage.myFloor.status === 'given' && !stage.myFloor.acknowledged;
  const microphoneBlocked = useMicrophoneBlocked(client, controller);
  const errors = useErrorMessages(error, stage.errorOf('floor'), microphoneBlocked);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stage.acknowledgeFloor();
      }}
    >
      <DialogContent title={t('webinar.floorDialog.title')} description={t('webinar.youCanSpeakNow')} closeLabel={t('webinar.floorDialog.close')}>
        <div data-testid="webinar-floor-dialog" className="gap-3 flex flex-col">
          <Alert tone="info" icon={<Record size={20} weight="fill" />}>
            {t('webinar.recordingNoticeFloor')}
          </Alert>
          <MotionFeatures>
            <ErrorStack messages={errors} testId="webinar-floor-error" />
          </MotionFeatures>
        </div>
        <DialogActions>
          <Button variant="secondary" onClick={() => stage.acknowledgeFloor()}>
            {t('webinar.floorDialog.later')}
          </Button>
          <Button
            leadingIcon={<Microphone size={20} weight="bold" />}
            onClick={() => {
              stage.acknowledgeFloor();
              controller.setMuted(false);
            }}
          >
            {t('webinar.floorDialog.unmute')}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export interface UnmuteConsentDialogProps {
  /** The attendee's webinar client; opens on `webinar.floor.unmute_requested` while they hold the floor. */
  client: WebinarClientApi;
  /** A failure from outside, already translated. */
  error?: string | null;
}

/**
 * WBN-26: a host asks the muted floor holder to unmute; only the attendee
 * decides. "Unmute" posts the consent (`POST .../unmute`) and unmutes;
 * "Stay muted" or closing sends nothing. A failure keeps the prompt open with
 * the error. Animated with the dialog preset.
 */
export function UnmuteConsentDialog({ client, error }: UnmuteConsentDialogProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const open = stage.myFloor.status === 'given' && stage.myFloor.unmuteRequested;
  const errors = useErrorMessages(error, stage.errorOf('floor'));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stage.declineUnmute();
      }}
    >
      <DialogContent title={t('webinar.unmuteRequest.title')} description={t('webinar.recordingNoticeFloor')} closeLabel={t('webinar.floorDialog.close')}>
        <div data-testid="webinar-unmute-consent" className="gap-3 flex flex-col">
          <MotionFeatures>
            <ErrorStack messages={errors} testId="webinar-unmute-error" />
          </MotionFeatures>
        </div>
        <DialogActions>
          <Button variant="secondary" onClick={() => stage.declineUnmute()}>
            {t('webinar.unmuteRequest.stayMuted')}
          </Button>
          <Button
            leadingIcon={<Microphone size={20} weight="bold" />}
            loading={stage.isPending('floor.unmute')}
            loadingLabel={t('webinar.chat.sending')}
            onClick={() => void stage.consentToUnmute().catch(() => undefined)}
          >
            {t('webinar.unmuteRequest.unmute')}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

export interface FloorTakenNoticeProps {
  client: WebinarClientApi;
  className?: string;
}

/** "The host took the floor back. Your microphone is off again." until the attendee dismisses it; animated in and out. */
export function FloorTakenNotice({ client, className }: FloorTakenNoticeProps) {
  const { t } = useTranslation('calls');
  const stage = useWebinarStage(client);
  const motion = useMotionPreset('popover');
  return (
    <MotionFeatures>
      <AnimatePresence>
        {stage.myFloor.status === 'taken' ? (
          <m.div
            key="floor-taken"
            {...motion}
            role="status"
            data-testid="webinar-floor-taken-notice"
            className={cn('gap-3 p-3 flex flex-wrap items-center rounded-card bg-surface text-text shadow-modal origin-top', className)}
          >
            <p className="type-body flex-1">{t('webinar.floorTaken')}</p>
            <Button size="sm" variant="secondary" onClick={() => stage.dismissFloorNotice()}>
              {t('webinar.floorTakenOk')}
            </Button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </MotionFeatures>
  );
}

import {
  CheckCircle,
  CircleNotch,
  Microphone,
  MonitorArrowUp,
  SpeakerHigh,
  VideoCamera,
  VideoCameraSlash,
  WarningCircle,
  WifiHigh,
} from '@phosphor-icons/react/dist/ssr';
import {
  Alert,
  AnimatePresence,
  Button,
  Field,
  LiveRegion,
  MotionFeatures,
  Select,
  Switch,
  VisuallyHidden,
  cn,
  m,
  useMotionPreset,
} from '@nestself/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { currentUserAgent, detectBrowser } from '../environment';
import type { BrowserFamily } from '../environment';
import { useCallSession } from '../hooks/useCallSession';
import { useDevices } from '../hooks/useDevices';
import type { CallSessionControllerApi, DeviceCheckResult, DeviceKind, DeviceOption } from '../types';
import { deviceLabel } from './device-label';

export interface PreJoinCheckProps {
  controller: CallSessionControllerApi;
  /**
   * The person selected Join. The app calls the join endpoint, then
   * `controller.join(response)` (CW-R-55a: never before the check finished).
   */
  onJoin: () => void;
  /** The join request is in flight. */
  joining?: boolean;
  /** A failed join, already translated (error-visibility rule). */
  error?: string | null;
  /** A NestSelf help page; replaces the browser vendor's page. */
  permissionHelpHref?: string;
  /** Overrides browser detection for the permission help (stories, tests). */
  browser?: BrowserFamily;
  className?: string;
}

/** Vendor pages for allowing camera and microphone access (UX-03). */
const BROWSER_HELP: Partial<Record<BrowserFamily, string>> = {
  chrome: 'https://support.google.com/chrome/answer/2693767',
  firefox: 'https://support.mozilla.org/kb/how-manage-your-camera-and-microphone-permissions',
};

const SPECIFIC_HELP: ReadonlySet<BrowserFamily> = new Set(['chrome', 'edge', 'firefox', 'safari']);

function useMicrophoneLevel(controller: CallSessionControllerApi, active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setLevel(controller.getMicrophoneLevel()), 100);
    return () => clearInterval(id);
  }, [controller, active]);
  return active ? level : 0;
}

function StatusIcon({ status }: { status: DeviceCheckResult | 'good' | 'degraded' | 'poor' | 'offline' }) {
  if (status === 'pending') return <CircleNotch size={20} className="text-text-secondary motion-safe:animate-spin" aria-hidden />;
  if (status === 'passed' || status === 'good') return <CheckCircle size={20} weight="fill" className="text-success" aria-hidden />;
  if (status === 'degraded') return <WarningCircle size={20} weight="fill" className="text-warning" aria-hidden />;
  return <WarningCircle size={20} weight="fill" className="text-danger" aria-hidden />;
}

function CheckRow({ icon, label, status, statusText, children }: { icon: ReactNode; label: string; status: Parameters<typeof StatusIcon>[0]['status'] | null; statusText?: string; children?: ReactNode }) {
  return (
    <li className="gap-3 py-3 flex items-start border-b border-border-subtle last:border-b-0">
      <span aria-hidden className="mt-0.5 inline-flex text-text-secondary">
        {icon}
      </span>
      <div className="gap-1 min-w-0 flex flex-1 flex-col">
        <div className="gap-2 flex flex-wrap items-center justify-between">
          <span className="type-label text-text">{label}</span>
          {status ? (
            <span className="gap-1.5 inline-flex items-center type-metadata text-text-secondary">
              <StatusIcon status={status} />
              {statusText}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

type ScreenShareResult = 'idle' | 'testing' | 'supported' | 'unsupported' | 'denied';

/**
 * Hosts only (WBN-16): an optional screen-sharing trial. It runs only when
 * the host presses the button (the browser asks which screen to share), and
 * every track stops at once; nothing is shared with anyone.
 */
function ScreenShareCheck() {
  const { t } = useTranslation('calls');
  const notice = useMotionPreset('popover');
  const [result, setResult] = useState<ScreenShareResult>('idle');

  const test = async () => {
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (typeof media?.getDisplayMedia !== 'function') {
      setResult('unsupported');
      return;
    }
    setResult('testing');
    try {
      const stream = await media.getDisplayMedia({ video: true, audio: false });
      for (const track of stream.getTracks()) track.stop();
      setResult('supported');
    } catch (error) {
      setResult((error as { name?: unknown } | null)?.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    }
  };

  const status = result === 'supported' ? 'passed' : result === 'unsupported' || result === 'denied' ? 'failed' : null;
  return (
    <CheckRow icon={<MonitorArrowUp size={20} />} label={t('prejoin.screenShare.label')} status={status}>
      <p className="type-metadata text-text-secondary">{t('prejoin.screenShare.hint')}</p>
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        loading={result === 'testing'}
        loadingLabel={t('prejoin.screenShare.testing')}
        onClick={() => void test()}
        data-testid="prejoin-screen-share-test"
      >
        {t('prejoin.screenShare.test')}
      </Button>
      <MotionFeatures>
        <AnimatePresence initial={false}>
          {result === 'supported' || result === 'unsupported' || result === 'denied' ? (
            <m.p
              key={result}
              {...notice}
              role="status"
              data-testid="prejoin-screen-share-result"
              className={cn('type-metadata origin-top', result === 'supported' ? 'text-success' : 'text-danger')}
            >
              {t(`prejoin.screenShare.${result}`)}
            </m.p>
          ) : null}
        </AnimatePresence>
      </MotionFeatures>
    </CheckRow>
  );
}

/**
 * The mandatory pre-join check (D-CW-21): camera, microphone, speaker and
 * network through `MeetingReadinessChecker` (OPS-30), a self-view preview,
 * device selection, "join with camera off", opt-in background blur and
 * browser-specific permission help (UX-01 to UX-04, UX-11). Join stays
 * disabled until the check finished and the microphone works (CALL-03).
 * Webinar attendees get no camera preview or camera toggle (CW-R-124).
 *
 * The panel animates in; wrap it in `AnimatePresence` to animate it out.
 */
export function PreJoinCheck({ controller, onJoin, joining = false, error, permissionHelpHref, browser, className }: PreJoinCheckProps) {
  const { t } = useTranslation('calls');
  const call = useCallSession(controller);
  const devices = useDevices(controller);
  const panelMotion = useMotionPreset('dialog');
  const disclosureMotion = useMotionPreset('popover');
  const titleId = useId();
  const helpTitleId = useId();
  const joinHintId = useId();
  const previewRef = useRef<HTMLVideoElement>(null);

  const { readiness } = call;
  const done = readiness.status === 'done';
  const video = devices.canSendVideo;
  const audio = devices.canSendAudio;
  const family = browser ?? detectBrowser(currentUserAgent());
  const helpHref = permissionHelpHref ?? BROWSER_HELP[family];
  const denied = devices.permissions.camera === 'denied' || devices.permissions.microphone === 'denied';
  const microphoneBlocked = audio && done && devices.permissions.microphone !== 'granted';
  const previewVisible = video && done && devices.permissions.camera === 'granted' && !devices.cameraOff;
  const level = useMicrophoneLevel(controller, audio && done && devices.permissions.microphone === 'granted');

  useEffect(() => {
    void controller.checkReadiness();
  }, [controller]);

  useEffect(() => {
    if (!video) return undefined;
    controller.bindPreview(previewRef.current);
    return () => controller.bindPreview(null);
  }, [controller, video]);

  const deviceStatus = (result: DeviceCheckResult) => t(`prejoin.status.${result}`);
  const selectOptions = (kind: DeviceKind, list: readonly DeviceOption[]) =>
    list.map((device, index) => ({ value: device.deviceId, label: deviceLabel(t, kind, device, index) }));

  return (
    <MotionFeatures>
      <m.section
        {...panelMotion}
        aria-labelledby={titleId}
        className={cn('gap-6 p-6 pointer-coarse:p-4 flex w-full max-w-4xl flex-col rounded-card bg-surface shadow-low', className)}
      >
        <header className="gap-1 flex flex-col">
          <h2 id={titleId} className="type-section-title text-text">
            {t('prejoin.title')}
          </h2>
          <p className="type-body text-text-secondary">{t('prejoin.description')}</p>
          <LiveRegion politeness="polite">
            {readiness.status === 'running' ? (
              <p className="gap-2 mt-2 flex items-center type-body text-text">
                <CircleNotch size={18} className="motion-safe:animate-spin" aria-hidden />
                {t('prejoin.checkingDevices')}
              </p>
            ) : null}
          </LiveRegion>
        </header>

        <div className={cn('gap-6 grid', video && 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]')}>
          {video ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-control bg-tint">
              <video
                ref={previewRef}
                aria-label={t('prejoin.previewLabel')}
                autoPlay
                muted
                playsInline
                className={cn('h-full w-full -scale-x-100 object-cover', !previewVisible && 'invisible')}
              />
              {!previewVisible ? (
                <div className="gap-2 p-4 absolute inset-0 flex flex-col items-center justify-center text-center text-text-secondary">
                  <VideoCameraSlash size={32} aria-hidden />
                  <p className="type-body">
                    {devices.cameraOff
                      ? t('prejoin.previewOff')
                      : done
                        ? t('prejoin.previewUnavailable')
                        : t('prejoin.status.pending')}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="m-0 p-0 list-none">
            {video ? (
              <CheckRow icon={<VideoCamera size={20} />} label={t('prejoin.camera')} status={readiness.camera} statusText={deviceStatus(readiness.camera)}>
                {devices.permissions.camera === 'error' ? <p className="type-metadata text-danger">{t('prejoin.cameraError')}</p> : null}
              </CheckRow>
            ) : null}
            {audio ? (
              <CheckRow icon={<Microphone size={20} />} label={t('prejoin.microphone')} status={readiness.microphone} statusText={deviceStatus(readiness.microphone)}>
                {devices.permissions.microphone === 'granted' ? (
                  <>
                    <div aria-hidden className="h-2 w-full overflow-hidden rounded-pill bg-border-subtle">
                      <div
                        className="h-full w-full origin-left bg-primary transition-transform duration-[var(--motion-fast)] ease-standard"
                        style={{ transform: `scaleX(${level})` }}
                      />
                    </div>
                    <p className="type-metadata text-text-secondary">{t('prejoin.microphoneHint')}</p>
                  </>
                ) : null}
                {devices.permissions.microphone === 'error' ? <p className="type-metadata text-danger">{t('prejoin.microphoneError')}</p> : null}
              </CheckRow>
            ) : null}
            <CheckRow icon={<SpeakerHigh size={20} />} label={t('prejoin.speaker')} status={null}>
              <MotionFeatures>
                <AnimatePresence mode="wait" initial={false}>
                  {readiness.speaker === 'playing' ? (
                    <m.div key="question" {...disclosureMotion} className="gap-2 flex flex-col items-start origin-top-left">
                      <p className="type-body text-text">{t('prejoin.speakerQuestion')}</p>
                      <div className="gap-2 flex flex-wrap">
                        <Button size="sm" onClick={() => controller.confirmSpeaker(true)}>
                          {t('prejoin.speakerYes')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => controller.confirmSpeaker(false)}>
                          {t('prejoin.speakerNo')}
                        </Button>
                      </div>
                    </m.div>
                  ) : (
                    <m.div key="test" {...disclosureMotion} className="gap-2 flex flex-col items-start origin-top-left">
                      {readiness.speaker === 'heard' ? <p className="type-metadata text-success">{t('prejoin.speakerHeard')}</p> : null}
                      {readiness.speaker === 'not_heard' ? <p className="type-metadata text-text">{t('prejoin.speakerNotHeard')}</p> : null}
                      {readiness.speaker === 'failed' ? <p className="type-metadata text-danger">{t('prejoin.speakerFailed')}</p> : null}
                      <Button size="sm" variant="secondary" onClick={() => void controller.testSpeaker()}>
                        {t('prejoin.speakerTest')}
                      </Button>
                    </m.div>
                  )}
                </AnimatePresence>
              </MotionFeatures>
            </CheckRow>
            <CheckRow
              icon={<WifiHigh size={20} />}
              label={t('prejoin.network')}
              status={readiness.network}
              statusText={t(`prejoin.networkStatus.${readiness.network}`)}
            >
              {readiness.network === 'poor' ? <p className="type-metadata text-text">{t('prejoin.networkPoorHint')}</p> : null}
              {readiness.network === 'offline' ? <p className="type-metadata text-danger">{t('prejoin.networkOfflineHint')}</p> : null}
            </CheckRow>
            {call.role === 'presenter' || call.role === 'moderator' ? <ScreenShareCheck /> : null}
          </ul>
        </div>

        <MotionFeatures>
          <AnimatePresence>
            {done && denied ? (
              <m.section
                key="permission-help"
                {...disclosureMotion}
                aria-labelledby={helpTitleId}
                className="gap-3 p-4 flex flex-col items-start rounded-control bg-warning-surface text-text origin-top"
              >
                <h3 id={helpTitleId} className="type-label">
                  {t('prejoin.permissionDeniedTitle')}
                </h3>
                <p className="type-body">{SPECIFIC_HELP.has(family) ? t(`prejoin.permissionDenied.${family}`) : t('prejoin.permissionHelp')}</p>
                <div className="gap-3 flex flex-wrap items-center">
                  <Button size="sm" variant="secondary" onClick={() => void controller.checkReadiness()}>
                    {t('prejoin.checkAgain')}
                  </Button>
                  {helpHref ? (
                    <a
                      href={helpHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-11 inline-flex items-center type-body underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      {t('prejoin.permissionHelpLink')}
                      <VisuallyHidden>{` ${t('prejoin.opensInNewTab')}`}</VisuallyHidden>
                    </a>
                  ) : null}
                </div>
              </m.section>
            ) : null}
          </AnimatePresence>
        </MotionFeatures>

        {done && (video || audio || devices.speakers.length > 0) ? (
          <div className="gap-4 grid sm:grid-cols-2 lg:grid-cols-3">
            {video && devices.cameras.length > 0 ? (
              <Field label={t('prejoin.camera')}>
                <Select
                  options={selectOptions('camera', devices.cameras)}
                  value={devices.selected.camera ?? undefined}
                  onValueChange={(value) => value && void devices.selectDevice('camera', value)}
                />
              </Field>
            ) : null}
            {audio && devices.microphones.length > 0 ? (
              <Field label={t('prejoin.microphone')}>
                <Select
                  options={selectOptions('microphone', devices.microphones)}
                  value={devices.selected.microphone ?? undefined}
                  onValueChange={(value) => value && void devices.selectDevice('microphone', value)}
                />
              </Field>
            ) : null}
            {devices.speakers.length > 0 ? (
              <Field label={t('prejoin.speaker')}>
                <Select
                  options={selectOptions('speaker', devices.speakers)}
                  value={devices.selected.speaker ?? undefined}
                  onValueChange={(value) => value && void devices.selectDevice('speaker', value)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {video ? (
          <div className="gap-4 grid sm:grid-cols-2">
            <div className="gap-1 flex flex-col">
              <Switch checked={devices.cameraOff} onCheckedChange={(checked) => void devices.setCameraOff(checked)}>
                {t('prejoin.cameraOff')}
              </Switch>
              <p className="type-metadata text-text-secondary">{t('prejoin.cameraOffHint')}</p>
            </div>
            <div className="gap-1 flex flex-col">
              <Switch
                checked={devices.blur.enabled}
                disabled={devices.blur.supported === false || devices.blur.loading}
                onCheckedChange={(checked) => void devices.setBlur(checked)}
              >
                {t('prejoin.blur')}
              </Switch>
              <p className="type-metadata text-text-secondary">
                {devices.blur.loading
                  ? t('prejoin.blurLoading')
                  : devices.blur.supported === false
                    ? t('prejoin.blurUnavailable')
                    : t('prejoin.blurHint')}
              </p>
            </div>
          </div>
        ) : null}

        <MotionFeatures>
          <AnimatePresence>
            {error ? (
              <m.div key="error" {...disclosureMotion} className="origin-top">
                <Alert tone="danger">{error}</Alert>
              </m.div>
            ) : null}
          </AnimatePresence>
        </MotionFeatures>

        <div className="gap-3 flex flex-wrap items-center">
          <Button
            onClick={onJoin}
            disabled={!call.canJoin}
            loading={joining}
            loadingLabel={t('prejoin.joining')}
            aria-describedby={!done || microphoneBlocked ? joinHintId : undefined}
          >
            {t('prejoin.joinNow')}
          </Button>
          {!done ? (
            <p id={joinHintId} className="type-metadata text-text-secondary">
              {t('prejoin.joinDisabledHint')}
            </p>
          ) : microphoneBlocked ? (
            <p id={joinHintId} className="type-metadata text-danger">
              {t('prejoin.microphoneRequired')}
            </p>
          ) : null}
        </div>
      </m.section>
    </MotionFeatures>
  );
}

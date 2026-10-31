/**
 * Pieces shared by the webinar list, detail and live routes: the title in
 * the reader's language, the schedule in the occurrence's time zone, the
 * status and places badges, the recording notice (D-CW-34) and the
 * registration action with its translated outcome (WBN-02, WBN-03).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Record as RecordIcon } from '@phosphor-icons/react';
import { Alert, Badge, Button } from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import type { WebinarResponse, WebinarStatus } from '@nestself/contracts';
import { webinarKeys } from '@nestself/api-client';
import { isSampleDataMode } from '../data-source';
import { Reveal } from '../calls/reveal';
import { mapWebinarError } from './map-webinar-error';
import { webinarsApi } from './webinars-api';

const STATUS_TONE: Readonly<Record<WebinarStatus, BadgeTone>> = {
  draft: 'neutral',
  published: 'info',
  live: 'success',
  ended: 'neutral',
  canceled: 'warning',
};

export function WebinarStatusBadge({ status }: { status: WebinarStatus }) {
  const { t } = useTranslation('calls');
  return <Badge tone={STATUS_TONE[status]}>{t(`webinar.status.${status}`)}</Badge>;
}

/** Places remaining (WBN-01); a number only, never who registered. */
export function PlacesBadge({ webinar }: { webinar: Pick<WebinarResponse, 'capacityRemaining'> }) {
  const { t } = useTranslation('calls');
  if (webinar.capacityRemaining === 0) return <Badge tone="warning">{t('webinar.full')}</Badge>;
  return <Badge>{t('webinar.placesLeft', { count: webinar.capacityRemaining })}</Badge>;
}

/** "This webinar is recorded; only the presenters are on the recording." (D-CW-34, CW-R-126, WBN-06). */
export function RecordingNotice() {
  const { t } = useTranslation('calls');
  return (
    <p className="gap-2 p-3 flex items-start rounded-control bg-info-surface text-info type-body" data-testid="webinar-recording-notice">
      <RecordIcon size={20} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
      {t('webinar.recordingNotice')}
    </p>
  );
}

type Outcome = { tone: 'success' | 'info' | 'danger'; message: string } | null;

/**
 * Register (and, on the detail page, cancel the registration). Success and
 * every failure (`webinar_full`, `not_eligible`, `already_registered`,
 * `registration_closed`, `webinar_not_open`) render as translated copy.
 * Sample mode sends nothing and says so.
 */
export function RegistrationAction({ webinar, allowUnregister = false }: { webinar: WebinarResponse; allowUnregister?: boolean }) {
  const { t } = useTranslation('calls');
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<'register' | 'unregister' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const open = webinar.status === 'published';

  const run = async (kind: 'register' | 'unregister') => {
    setOutcome(null);
    if (isSampleDataMode) {
      setOutcome({ tone: 'info', message: t('sample.actionNoop') });
      return;
    }
    setPending(kind);
    try {
      if (kind === 'register') await webinarsApi.register(webinar.id);
      else await webinarsApi.unregister(webinar.id);
      setOutcome({ tone: 'success', message: t(kind === 'register' ? 'webinar.registeredSuccess' : 'webinar.unregisteredSuccess') });
      await queryClient.invalidateQueries({ queryKey: webinarKeys.all });
    } catch (err) {
      setOutcome({ tone: 'danger', message: mapWebinarError(err, t) });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="gap-3 flex flex-col">
      {open && !webinar.registered ? (
        <Button className="self-start" onClick={() => void run('register')} loading={pending === 'register'} loadingLabel={t('webinar.registering')}>
          {t('webinar.register')}
        </Button>
      ) : null}
      {open && webinar.registered && allowUnregister ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => void run('unregister')}
          loading={pending === 'unregister'}
          loadingLabel={t('webinar.unregistering')}
        >
          {t('webinar.unregister')}
        </Button>
      ) : null}
      <Reveal show={outcome !== null}>
        <Alert tone={outcome?.tone ?? 'info'}>{outcome?.message}</Alert>
      </Reveal>
    </div>
  );
}

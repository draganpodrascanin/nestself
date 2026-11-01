import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Field,
  Heading,
  Input,
  Skeleton,
  StatusBlock,
  Table,
  Td,
  Text,
  Th,
  useToast,
} from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import { formatDateTime, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { SurveyCycleListResponse, SurveyCycleResponse, SurveyCycleStatus } from '@nestself/contracts';
import { useAuth } from '../../auth';
import { useOrgContext } from '../people/use-org-context';
import type { ListeningApi } from './listening-api';
import { listeningErrorMessageKey } from './listening-errors';
import { sampleCycles } from './sample-listening';
import { useCancelCycle, useCycles, useScheduleCycle } from './use-listening';

const STATUS_TONE: Record<SurveyCycleStatus, BadgeTone> = {
  scheduled: 'info',
  open: 'success',
  closing: 'warning',
  published: 'neutral',
  canceled: 'neutral',
  failed: 'danger',
};

export interface CyclesScreenProps {
  listeningApi: ListeningApi;
  sampleMode: boolean;
}

/** The close of a cycle that opens at `opensAt`, in the organization's zone (spec SUR-02 "dates are previewed in organization time"). */
export function closePreview(opensAt: string, windowDays: number, timeZone: string, locale: Locale): string | null {
  const opens = new Date(opensAt);
  if (Number.isNaN(opens.getTime())) return null;
  const closes = new Date(opens.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat(localeMeta[locale].intl, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(closes);
}

/**
 * The survey administrator's cycles (spec SUR-02): the schedule rules, a safe
 * audience total, every cycle with its state, scheduling with an
 * organization-time preview, and cancellation with confirmation. Never a
 * participation list.
 */
export function CyclesScreen({ listeningApi, sampleMode }: CyclesScreenProps) {
  const { t, i18n } = useTranslation(['listening', 'common']);
  const locale = (i18n.resolvedLanguage ?? 'en') as Locale;
  const { principal } = useAuth();
  const { orgId, needsChoice, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useCycles(listeningApi, apiOrgId);
  const schedule = useScheduleCycle(listeningApi, orgId ?? '');
  const cancel = useCancelCycle(listeningApi, orgId ?? '');
  const { add: addToast } = useToast();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [opensAtLocal, setOpensAtLocal] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SurveyCycleResponse | null>(null);
  const opensAtId = useId();

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('listening:cycles.title')}</Heading>
      <Text tone="secondary">{t('listening:cycles.lead')}</Text>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t(needsChoice ? 'workspace:people.chooseOrganization' : 'workspace:people.noOrganization', { ns: 'workspace' })}</Alert>
      </div>
    );
  }
  if (!sampleMode && (switchError || query.isError)) {
    const key = listeningErrorMessageKey(switchError ?? query.error);
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="danger">{t(key ?? 'listening:errors.unknown')}</Alert>
      </div>
    );
  }
  if (!sampleMode && query.isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton lines={5} label={t('common:state.loading')} />
      </div>
    );
  }
  const data: SurveyCycleListResponse | undefined = sampleMode ? sampleCycles() : query.data;
  if (!data) return <div className="space-y-6">{header}</div>;
  const { configuration } = data;

  const opensAtIso = opensAtLocal ? new Date(opensAtLocal).toISOString() : null;
  const preview = opensAtIso ? closePreview(opensAtIso, configuration.responseWindowDays, configuration.timeZone, locale) : null;

  const onSchedule = (event: FormEvent) => {
    event.preventDefault();
    setScheduleError(null);
    if (!opensAtIso) {
      setScheduleError(t('listening:errors.validation'));
      return;
    }
    schedule.mutate(
      { opensAt: opensAtIso },
      {
        onSuccess: () => {
          setScheduleOpen(false);
          setOpensAtLocal('');
          addToast({ title: t('listening:cycles.status.scheduled'), tone: 'success' });
        },
        onError: (error) => {
          const key = listeningErrorMessageKey(error);
          if (key) setScheduleError(t(key));
        },
      },
    );
  };

  const onCancel = () => {
    if (!cancelTarget) return;
    cancel.mutate(cancelTarget.id, {
      onSuccess: () => {
        setCancelTarget(null);
        addToast({ title: t('listening:cycles.status.canceled'), tone: 'info' });
      },
      onError: (error) => {
        setCancelTarget(null);
        const key = listeningErrorMessageKey(error);
        if (key) addToast({ title: t(key), tone: 'danger' });
      },
    });
  };

  return (
    <div className="space-y-8">
      {header}
      {sampleMode ? <Alert tone="info">{t('listening:cycles.sampleNote')}</Alert> : null}

      <section aria-labelledby="cycles-rules" className="space-y-2">
        <Heading level={2} typeRole="sectionTitle" id="cycles-rules">
          {t('listening:settings.rules')}
        </Heading>
        <ul className="grid gap-2 sm:grid-cols-2">
          <li className="type-body">{t('listening:cycles.cadence', { days: configuration.cadenceDays })}</li>
          <li className="type-body">{t('listening:cycles.window', { days: configuration.responseWindowDays })}</li>
          <li className="type-body">{t('listening:cycles.reminders', { count: configuration.reminderLimit })}</li>
          <li className="type-body">{t('listening:cycles.audience', { count: configuration.activeMemberCount })}</li>
          <li className="type-body">
            {configuration.questionnaireVersion ? t('listening:cycles.questionnaire', { version: configuration.questionnaireVersion }) : t('listening:cycles.noQuestionnaire')}
          </li>
          <li className="type-body">
            {configuration.nextLaunchAt ? t('listening:cycles.nextLaunch', { date: formatDateTime(configuration.nextLaunchAt, locale) }) : t('listening:cycles.noNextLaunch')}
          </li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={2} typeRole="sectionTitle">
          {t('listening:cycles.title')}
        </Heading>
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <Button variant="primary" onClick={() => setScheduleOpen(true)} disabled={sampleMode || !configuration.questionnaireVersion}>
            {t('listening:cycles.schedule')}
          </Button>
          <DialogContent title={t('listening:cycles.scheduleTitle')} closeLabel={t('common:action.cancel')}>
            <form onSubmit={onSchedule} className="space-y-4" noValidate>
              <Field label={t('listening:cycles.opensAt')} id={opensAtId} error={scheduleError ?? undefined} required>
                <Input type="datetime-local" value={opensAtLocal} onChange={(e) => setOpensAtLocal(e.target.value)} required />
              </Field>
              <Button variant="ghost" size="sm" type="button" onClick={() => setOpensAtLocal(toLocalInput(new Date()))}>
                {t('listening:cycles.opensNow')}
              </Button>
              {preview ? (
                <Text tone="secondary" typeRole="metadata" role="status">
                  {t('listening:cycles.closesPreview', { date: preview, zone: configuration.timeZone })}
                </Text>
              ) : null}
              <DialogActions>
                <Button variant="secondary" type="button" onClick={() => setScheduleOpen(false)}>
                  {t('common:action.cancel')}
                </Button>
                <Button variant="primary" type="submit" disabled={schedule.isPending}>
                  {schedule.isPending ? t('listening:cycles.scheduling') : t('listening:cycles.scheduleAction')}
                </Button>
              </DialogActions>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {data.items.length === 0 ? (
        <StatusBlock state="empty" title={t('listening:cycles.empty')} body={t('listening:cycles.lead')} />
      ) : (
        <Table density="default">
          <thead>
            <tr>
              <Th>{t('listening:cycles.columns.opens')}</Th>
              <Th>{t('listening:cycles.columns.closes')}</Th>
              <Th>{t('listening:cycles.columns.status')}</Th>
              <Th numeric>{t('listening:cycles.columns.audience')}</Th>
              <Th>{t('listening:cycles.columns.result')}</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((cycle) => (
              <tr key={cycle.id}>
                <Td>{formatDateTime(cycle.opensAt, locale)}</Td>
                <Td>{formatDateTime(cycle.closesAt, locale)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[cycle.status]}>{t(`listening:cycles.status.${cycle.status}`)}</Badge>
                </Td>
                <Td numeric>{cycle.audienceSize ?? t('listening:cycles.noAudience')}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {cycle.publishedSnapshotId ? (
                      <Link to="/listening/heatmap" search={{ snapshotId: cycle.publishedSnapshotId }} className="type-label text-primary underline">
                        {t('listening:cycles.viewReport')}
                      </Link>
                    ) : null}
                    {(cycle.status === 'scheduled' || cycle.status === 'open') && !sampleMode ? (
                      <Button variant="ghost" size="sm" onClick={() => setCancelTarget(cycle)}>
                        {t('listening:cycles.cancel')}
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent
          title={t('listening:cycles.cancelTitle')}
          description={t('listening:cycles.cancelBody')}
          confirmLabel={t('listening:cycles.cancelConfirm')}
          cancelLabel={t('common:action.cancel')}
          destructive
          onConfirm={onCancel}
          confirmPending={cancel.isPending}
        />
      </AlertDialog>
    </div>
  );
}

/** `YYYY-MM-DDTHH:mm` in the browser's zone, for a `datetime-local` input. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

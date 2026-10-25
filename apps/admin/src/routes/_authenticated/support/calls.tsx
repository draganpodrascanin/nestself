/**
 * `/support/calls` (PLT-05, CALL-16): a support operator looks up a call
 * session's diagnostics (exactly the D-CW-28 fields; every lookup is audited
 * by the API) and reads the technical problem reports of the organisations
 * they support. Gated on `diagnostic.read`; the API authorises each read and
 * answers 404 to anyone else.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Field, Heading, Input, StatusBlock, Table, Td, Text, Th } from '@nestself/ui';
import { ApiError, diagnosticsQuery, problemReportListQuery } from '@nestself/api-client';
import type { ProblemReportItem } from '@nestself/api-client';
import { can } from '@nestself/contracts';
import type { DiagnosticsResponse } from '@nestself/contracts';
import { SAMPLE_CALL_SESSIONS } from '@nestself/sample-data';
import { classifyQuality } from '@nestself/video';
import { resolveRouteAuth, useAuth } from '../../../auth';
import { isSampleDataMode } from '../../../data-source';
import { callsApi } from '../../../calls/calls-api';
import { mapCallError } from '../../../calls/map-call-error';
import { Reveal } from '../../../calls/reveal';

const DIAGNOSTIC_ACTION = 'diagnostic.read';

export const Route = createFileRoute('/_authenticated/support/calls')({
  beforeLoad: async ({ context }) => {
    const { principal, effectiveActions } = await resolveRouteAuth(context.auth);
    if (!principal) {
      if (isSampleDataMode) return;
      throw redirect({ to: '/sign-in' });
    }
    if (!can(principal, DIAGNOSTIC_ACTION, undefined, effectiveActions)) throw redirect({ to: '/' });
  },
  component: SupportCallsPage,
});

/** Sample mode: the diagnostics of a sample session, shaped as the API answers them. */
function sampleDiagnostics(sessionId: string): DiagnosticsResponse | null {
  const session = SAMPLE_CALL_SESSIONS.find((candidate) => candidate.id === sessionId);
  if (!session) return null;
  return {
    sessionId: session.id,
    appointmentId: session.appointmentId,
    webinarId: session.webinarId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    provider: 'chime',
    providerMeetingId: session.providerMeetingId,
    participants: session.participants.map((participant) => ({
      role: participant.role,
      joinedAt: participant.firstJoinedAt,
      leftAt: participant.lastLeftAt,
      reconnectCount: participant.reconnectCount,
      qualityMetrics: session.outcome?.connectionMetrics ?? null,
      errorCodes: [],
      browser: null,
      os: null,
    })),
    problemReports: [],
  };
}

function useReaderFormat() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  return (instant: string | null, fallback: string) =>
    instant ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(instant)) : fallback;
}

function DiagnosticsView({ diagnostics }: { diagnostics: DiagnosticsResponse }) {
  const { t } = useTranslation('calls');
  const when = useReaderFormat();
  const none = t('supportCalls.notRecorded');
  const rows = [
    { term: t('supportCalls.fields.status'), description: t(`supportCalls.sessionStatus.${diagnostics.status}`) },
    { term: t('supportCalls.fields.provider'), description: diagnostics.provider },
    { term: t('supportCalls.fields.startedAt'), description: when(diagnostics.startedAt, none) },
    { term: t('supportCalls.fields.endedAt'), description: when(diagnostics.endedAt, none) },
    { term: t('supportCalls.fields.appointment'), description: diagnostics.appointmentId ?? diagnostics.webinarId ?? none },
    { term: t('supportCalls.fields.providerMeetingId'), description: diagnostics.providerMeetingId ?? none },
  ];
  return (
    <Card as="section" className="gap-4 flex flex-col">
      <Heading level={2} typeRole="sectionTitle">
        {t('supportCalls.sessionTitle', { id: diagnostics.sessionId })}
      </Heading>
      <dl className="gap-x-6 gap-y-2 m-0 grid sm:grid-cols-[max-content_1fr]">
        {rows.map((row) => (
          <div key={row.term} className="contents">
            <dt className="type-label text-text-secondary">{row.term}</dt>
            <dd className="m-0 text-text break-all">{row.description}</dd>
          </div>
        ))}
      </dl>
      <h3 className="type-label text-text">{t('supportCalls.participantsTitle')}</h3>
      {diagnostics.participants.length === 0 ? (
        <Text className="text-text-secondary">{t('supportCalls.noParticipants')}</Text>
      ) : (
        <Table caption={t('supportCalls.participantsTitle')}>
          <thead>
            <tr>
              <Th>{t('supportCalls.participant.role')}</Th>
              <Th>{t('supportCalls.participant.joinedAt')}</Th>
              <Th>{t('supportCalls.participant.leftAt')}</Th>
              <Th numeric>{t('supportCalls.participant.reconnects')}</Th>
              <Th>{t('supportCalls.participant.quality')}</Th>
              <Th>{t('supportCalls.participant.errors')}</Th>
              <Th>{t('supportCalls.participant.browser')}</Th>
              <Th>{t('supportCalls.participant.os')}</Th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.participants.map((participant, index) => (
              <tr key={`${participant.role}-${index}`}>
                <Td>{t(`supportCalls.roles.${participant.role}`)}</Td>
                <Td>{when(participant.joinedAt, none)}</Td>
                <Td>{when(participant.leftAt, none)}</Td>
                <Td numeric>{participant.reconnectCount}</Td>
                <Td>{participant.qualityMetrics ? t(`connection.${classifyQuality(participant.qualityMetrics)}`) : none}</Td>
                <Td>{participant.errorCodes.length > 0 ? participant.errorCodes.join(', ') : none}</Td>
                <Td>{participant.browser ?? none}</Td>
                <Td>{participant.os ?? none}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function ProblemReports({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const when = useReaderFormat();
  const query = useInfiniteQuery({ ...problemReportListQuery(callsApi), enabled: !isSampleDataMode });
  const items: ProblemReportItem[] = query.data?.pages.flatMap((page) => page.items) ?? [];
  const summaryOf = (report: ProblemReportItem) =>
    tCalls('supportCalls.summary', {
      duration:
        report.summary.durationMs === undefined
          ? tCalls('report.notMeasured')
          : tCalls('report.minutes', { count: Math.max(1, Math.round(report.summary.durationMs / 60_000)) }),
      reconnects: report.summary.reconnectCount ?? 0,
    });

  let body;
  if (!isSampleDataMode && query.isPending) body = <StatusBlock state="loading" title={t('common:state.loading')} body="" />;
  else if (query.error instanceof ApiError && query.error.status === 404) {
    // The listing needs a platform-scoped diagnostic.read; an assignment-scoped operator looks sessions up by id.
    body = <Alert tone="info">{tCalls('supportCalls.reportsUnavailable')}</Alert>;
  } else if (query.isError) {
    body = (
      <StatusBlock
        state="offline"
        title={tCalls('supportCalls.reportsFailed')}
        body={mapCallError(query.error, tCalls)}
        action={{ label: t('common:action.retry'), onClick: () => void query.refetch() }}
      />
    );
  } else if (items.length === 0) body = <Text className="text-text-secondary">{tCalls('supportCalls.reportsEmpty')}</Text>;
  else {
    body = (
      <Table caption={tCalls('supportCalls.reportsTitle')}>
        <thead>
          <tr>
            <Th>{tCalls('supportCalls.reportColumns.reportedAt')}</Th>
            <Th>{tCalls('supportCalls.reportColumns.role')}</Th>
            <Th>{tCalls('supportCalls.reportColumns.category')}</Th>
            <Th>{tCalls('supportCalls.reportColumns.summary')}</Th>
            <Th>{tCalls('supportCalls.reportColumns.session')}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((report) => (
            <tr key={`${report.sessionId}-${report.reportedAt}`}>
              <Td>{when(report.reportedAt, '')}</Td>
              <Td>{tCalls(`supportCalls.roles.${report.role}`)}</Td>
              <Td>{tCalls(`report.categories.${report.category}`)}</Td>
              <Td>{summaryOf(report)}</Td>
              <Td>
                <Button variant="secondary" size="sm" onClick={() => onOpen(report.sessionId)}>
                  {tCalls('supportCalls.openDiagnostics')}
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <section aria-labelledby="problem-reports" className="space-y-3">
      <Heading level={2} typeRole="sectionTitle" id="problem-reports">
        {tCalls('supportCalls.reportsTitle')}
      </Heading>
      {body}
      {query.hasNextPage ? (
        <Button variant="secondary" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage} loadingLabel={tCalls('appointments.loadingMore')}>
          {tCalls('appointments.loadMore')}
        </Button>
      ) : null}
    </section>
  );
}

function SupportCallsPage() {
  const { t } = useTranslation(['calls', 'common']);
  const { t: tCalls } = useTranslation('calls');
  const { principal, effectiveActions } = useAuth();
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const diagnostics = useQuery({ ...diagnosticsQuery(callsApi, sessionId ?? ''), enabled: !isSampleDataMode && sessionId !== null });

  if (!principal || !can(principal, DIAGNOSTIC_ACTION, undefined, effectiveActions)) {
    return <StatusBlock state="permission" title={t('common:state.permission.title')} body={t('common:state.permission.body')} />;
  }

  const lookUp = (id: string) => {
    setInputError(null);
    setDraft(id);
    setSessionId(id);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = draft.trim();
    if (!id) {
      setInputError(tCalls('supportCalls.required'));
      return;
    }
    lookUp(id);
  };

  const sample = isSampleDataMode && sessionId !== null ? sampleDiagnostics(sessionId) : null;
  const shown = isSampleDataMode ? sample : (diagnostics.data ?? null);
  const failure = isSampleDataMode
    ? sessionId !== null && !sample
      ? tCalls('supportCalls.notFound')
      : null
    : diagnostics.isError
      ? diagnostics.error instanceof ApiError && diagnostics.error.status === 404
        ? tCalls('supportCalls.notFound')
        : mapCallError(diagnostics.error, tCalls)
      : null;

  return (
    <div className="space-y-6">
      <div className="gap-2 flex flex-col">
        <Heading level={1}>{tCalls('supportCalls.title')}</Heading>
        <Text className="text-text-secondary">{tCalls('supportCalls.intro')}</Text>
        {isSampleDataMode ? <Alert tone="info">{tCalls('supportCalls.sampleNote')}</Alert> : null}
      </div>
      <form noValidate onSubmit={submit} className="gap-3 flex flex-wrap items-end">
        <Field label={tCalls('supportCalls.sessionId')} error={inputError ?? undefined} className="min-w-64 flex-1">
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" loading={diagnostics.isFetching} loadingLabel={tCalls('supportCalls.lookup')}>
          {tCalls('supportCalls.lookup')}
        </Button>
      </form>
      <Reveal show={failure !== null}>
        <Alert tone="warning">{failure}</Alert>
      </Reveal>
      {shown ? <DiagnosticsView diagnostics={shown} /> : null}
      <ProblemReports onOpen={lookUp} />
    </div>
  );
}

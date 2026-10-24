/**
 * Shared helpers for the NS-CALLS-01 Chime SDK spikes (T-CW-0.4). Results go to
 * docs/tasks/calls-webinars/research/07-spikes.md.
 *
 * Every spike built on `runSpike`:
 * - refuses any region but eu-central-1 (D-CW-06) and any AWS profile but
 *   `nestself-dev` (CLAUDE.md "AWS and CDK"); it never sets AWS_PROFILE itself;
 * - prints a header with the spike id, the question and the decisions it binds;
 * - registers every meeting and media pipeline it creates in a cleanup registry
 *   that runs in a `finally` block (and on Ctrl-C);
 * - never prints a join token: attendee ids and meeting ids only (OPS-07, D-CW-08);
 * - prints its measurements as one JSON object on the last line, ready to paste
 *   into 07-spikes.md;
 * - exits 0 when the measurement completed, 1 on failure, 2 when it refused to run.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  ChimeSDKMeetingsClient,
  CreateMeetingWithAttendeesCommand,
  DeleteMeetingCommand,
  type Attendee,
  type AttendeeCapabilities,
  type CreateAttendeeError,
  type CreateMeetingWithAttendeesCommandInput,
  type Meeting,
  type MeetingFeaturesConfiguration,
} from '@aws-sdk/client-chime-sdk-meetings';
import {
  ChimeSDKMediaPipelinesClient,
  CreateMediaCapturePipelineCommand,
  DeleteMediaCapturePipelineCommand,
  DeleteMediaPipelineCommand,
  GetMediaCapturePipelineCommand,
  type ChimeSdkMeetingConfiguration,
  type MediaPipelineStatus,
} from '@aws-sdk/client-chime-sdk-media-pipelines';
import { SQSClient } from '@aws-sdk/client-sqs';

/** The only region the spikes run in: control, media and media pipelines (D-CW-06, CW-R-06). */
export const CHIME_REGION = 'eu-central-1';
/** Every spike meeting's ExternalMeetingId starts with this prefix. */
export const EXTERNAL_MEETING_ID_PREFIX = 'spike-cw-';
/** The developer profile the repository's chpwd hook sets (CLAUDE.md "AWS and CDK"). */
const EXPECTED_PROFILE = 'nestself-dev';
/** Capture pipelines write under this prefix, which the bucket expires after 30 days (D-CW-18). */
export const RECORDINGS_RAW_PREFIX = 'raw';

export type SpikeEnvName = 'CHIME_EVENTS_QUEUE_URL' | 'CHIME_EVENTS_QUEUE_ARN' | 'RECORDINGS_BUCKET';

export interface SpikeMeta {
  /** `SPIKE-CW-nn` (canonical id, decision record section 7). */
  readonly id: string;
  /** Script file name, for the usage line. */
  readonly file: string;
  readonly question: string;
  /** Decision ids this spike binds (decision record section 8). */
  readonly binds: readonly string[];
}

export interface SpikeEnv {
  readonly region: typeof CHIME_REGION;
  readonly queueUrl?: string;
  readonly queueArn?: string;
  readonly bucket?: string;
  /** Account id parsed from CHIME_EVENTS_QUEUE_ARN, used for media pipeline source ARNs. */
  readonly accountId?: string;
  readonly credentials: string;
}

export interface SpikeOption {
  readonly type: 'string' | 'boolean';
  readonly description: string;
  readonly default?: string | boolean;
}

export type SpikeArgs = Readonly<Record<string, string | boolean | undefined>>;

export interface SpikeOutcome {
  /** Short classification of the answer, e.g. `same-meeting`. */
  readonly outcome: string;
  /** False when the measurement itself failed; the script then exits 1. Defaults to true. */
  readonly ok?: boolean;
  readonly measurements: Record<string, unknown>;
  readonly notes?: readonly string[];
}

export interface ErrorInfo {
  readonly name: string;
  readonly message: string;
  readonly httpStatus?: number;
}

/** Thrown when the environment is unsafe or incomplete; the script exits 2. */
export class SpikeRefusal extends Error {
  override readonly name = 'SpikeRefusal';
}

// ── Small utilities ──────────────────────────────────────────────────────────

export function describeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    return { name: error.name, message: redact(error.message), ...(status ? { httpStatus: status } : {}) };
  }
  return { name: 'Error', message: redact(String(error)) };
}

/** Removes anything that looks like a join token or a long opaque credential from a log line. */
export function redact(text: string): string {
  return text
    .replace(/_aws_wt_session\S*/g, '[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[redacted]');
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotFoundException' || error.name === 'ResourceNotFoundException');
}

export interface Summary {
  readonly n: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return { n: 0, min: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  return { n: sorted.length, min: sorted[0] ?? null, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? null };
}

export function stringArg(args: SpikeArgs, name: string, fallback: string): string {
  const value = args[name];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function numberArg(args: SpikeArgs, name: string, fallback: number): number {
  const value = args[name];
  if (typeof value !== 'string' || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new SpikeRefusal(`--${name} must be a non-negative number, got "${value}"`);
  return parsed;
}

export function flagArg(args: SpikeArgs, name: string): boolean {
  return args[name] === true;
}

/** Only the ids of an attendee; never the join token (OPS-07). */
export function attendeeIds(attendees: readonly (Attendee | undefined)[]): string[] {
  return attendees.map((a) => a?.AttendeeId ?? 'missing');
}

// ── Environment and guards ───────────────────────────────────────────────────

function chimeRegionFromEnv(): typeof CHIME_REGION {
  const value = process.env.CHIME_REGION?.trim();
  if (value && value !== CHIME_REGION) {
    throw new SpikeRefusal(
      `CHIME_REGION is "${value}". The spikes run in ${CHIME_REGION} only (D-CW-06, CW-R-68); unset it or set it to ${CHIME_REGION}.`,
    );
  }
  return CHIME_REGION;
}

function credentialSource(): string {
  const profile = process.env.AWS_PROFILE?.trim();
  if (profile && profile !== EXPECTED_PROFILE) {
    throw new SpikeRefusal(
      `AWS_PROFILE is "${profile}". The spikes run against the dev account with the ${EXPECTED_PROFILE} profile only (CLAUDE.md "AWS and CDK").`,
    );
  }
  if (profile) return `profile ${profile}`;
  const envCredentials =
    process.env.AWS_ACCESS_KEY_ID || process.env.AWS_WEB_IDENTITY_TOKEN_FILE || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  if (envCredentials) return 'environment credentials';
  throw new SpikeRefusal(
    `AWS_PROFILE is not set, so the SDK would use the [default] profile, which points at an unrelated account (CLAUDE.md "AWS and CDK"). ` +
      `Run from the main checkout (its chpwd hook sets AWS_PROFILE=${EXPECTED_PROFILE}) or prefix this one command with AWS_PROFILE=${EXPECTED_PROFILE}. Never export it globally.`,
  );
}

function arnPart(arn: string, index: number): string | undefined {
  return arn.split(':')[index];
}

export function loadSpikeEnv(required: readonly SpikeEnvName[]): SpikeEnv {
  const region = chimeRegionFromEnv();
  const credentials = credentialSource();
  const queueUrl = process.env.CHIME_EVENTS_QUEUE_URL?.trim() || undefined;
  const queueArn = process.env.CHIME_EVENTS_QUEUE_ARN?.trim() || undefined;
  const bucket = process.env.RECORDINGS_BUCKET?.trim() || undefined;

  const missing = required.filter((name) => {
    if (name === 'CHIME_EVENTS_QUEUE_URL') return !queueUrl;
    if (name === 'CHIME_EVENTS_QUEUE_ARN') return !queueArn;
    return !bucket;
  });
  if (missing.length > 0) {
    throw new SpikeRefusal(
      `Missing ${missing.join(', ')}. Deploy NestSelf-dev-Video, then run \`node infra/cdk/scripts/env-from-outputs.mjs dev\` and copy the CHIME_* and RECORDINGS_BUCKET lines into apps/api/.env.`,
    );
  }

  let accountId: string | undefined;
  if (queueArn) {
    const arnRegion = arnPart(queueArn, 3);
    accountId = arnPart(queueArn, 4);
    if (!queueArn.startsWith('arn:aws:sqs:') || arnRegion !== CHIME_REGION || !accountId || !/^\d{12}$/.test(accountId)) {
      throw new SpikeRefusal(`CHIME_EVENTS_QUEUE_ARN must be an SQS queue ARN in ${CHIME_REGION}; got "${queueArn}".`);
    }
    const devAccount = process.env.AWS_ACCOUNT_DEV?.trim();
    if (devAccount && devAccount !== accountId) {
      throw new SpikeRefusal(`The chime-events queue is in account ${accountId}, but AWS_ACCOUNT_DEV is ${devAccount}. Refusing to mix accounts.`);
    }
  }
  if (queueUrl && !queueUrl.startsWith(`https://sqs.${CHIME_REGION}.amazonaws.com/`)) {
    throw new SpikeRefusal(`CHIME_EVENTS_QUEUE_URL must be an SQS URL in ${CHIME_REGION}; got "${queueUrl}".`);
  }
  return { region, credentials, ...(queueUrl ? { queueUrl } : {}), ...(queueArn ? { queueArn } : {}), ...(bucket ? { bucket } : {}), ...(accountId ? { accountId } : {}) };
}

// ── Cleanup registry ─────────────────────────────────────────────────────────

interface CleanupTask {
  readonly label: string;
  readonly run: () => Promise<void>;
  /** The CLI command that does the same by hand, printed if the task fails. */
  readonly manual?: string;
}

export interface CleanupReport {
  readonly ok: boolean;
  readonly done: string[];
  readonly failed: { label: string; error: string; manual?: string }[];
}

export class Cleanup {
  private readonly tasks = new Map<string, CleanupTask>();
  private readonly done: string[] = [];
  private readonly failed: { label: string; error: string; manual?: string }[] = [];
  private running: Promise<CleanupReport> | undefined;

  constructor(private readonly log: (line: string) => void) {}

  add(key: string, task: CleanupTask): void {
    this.tasks.set(key, task);
  }

  has(key: string): boolean {
    return this.tasks.has(key);
  }

  /** Runs one task now (for example a meeting the spike deletes on purpose) and removes it. */
  async release(key: string): Promise<boolean> {
    const task = this.tasks.get(key);
    if (!task) return true;
    this.tasks.delete(key);
    return this.execute(task);
  }

  /** Forgets a task whose resource is already gone. */
  forget(key: string): void {
    this.tasks.delete(key);
  }

  /** Runs every remaining task, most recent first (pipelines and browsers before meetings). */
  runAll(): Promise<CleanupReport> {
    this.running ??= (async () => {
      const keys = [...this.tasks.keys()].reverse();
      for (const key of keys) {
        const task = this.tasks.get(key);
        this.tasks.delete(key);
        if (task) await this.execute(task);
      }
      return { ok: this.failed.length === 0, done: [...this.done], failed: [...this.failed] };
    })();
    return this.running;
  }

  private async execute(task: CleanupTask): Promise<boolean> {
    try {
      await task.run();
      this.done.push(task.label);
      this.log(`cleanup: ${task.label}`);
      return true;
    } catch (error) {
      const info = describeError(error);
      this.failed.push({ label: task.label, error: `${info.name}: ${info.message}`, ...(task.manual ? { manual: task.manual } : {}) });
      this.log(`cleanup FAILED: ${task.label}: ${info.name}: ${info.message}`);
      return false;
    }
  }
}

// ── Spike context and runner ─────────────────────────────────────────────────

export interface SpikeContext {
  readonly meta: SpikeMeta;
  /** Short run id, part of every ExternalMeetingId and S3 prefix this run creates. */
  readonly runId: string;
  readonly env: SpikeEnv;
  readonly args: SpikeArgs;
  readonly cleanup: Cleanup;
  /** Aborted on the first Ctrl-C: long waits end early and the spike reports what it has. */
  readonly signal: AbortSignal;
  readonly meetings: ChimeSDKMeetingsClient;
  readonly pipelines: ChimeSDKMediaPipelinesClient;
  readonly sqs: SQSClient;
  log(line: string): void;
  /** Resolves false when interrupted. */
  sleep(ms: number): Promise<boolean>;
}

export interface SpikeDefinition {
  readonly meta: SpikeMeta;
  readonly requiredEnv: readonly SpikeEnvName[];
  readonly options?: Readonly<Record<string, SpikeOption>>;
  /** Extra lines printed under the usage line by --help. */
  readonly help?: readonly string[];
  run(ctx: SpikeContext): Promise<SpikeOutcome>;
}

function spikeNumber(meta: SpikeMeta): string {
  return meta.id.replace(/^SPIKE-CW-/, '');
}

function newRunId(): string {
  return `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

function rule(): string {
  return '='.repeat(78);
}

function printHeader(meta: SpikeMeta, lines: readonly string[]): void {
  console.log(rule());
  console.log(`${meta.id}  ${meta.file}`);
  console.log(`Question: ${meta.question}`);
  console.log(`Binds:    ${meta.binds.join(', ')}`);
  for (const line of lines) console.log(line);
  console.log(rule());
}

function printUsage(def: Pick<SpikeDefinition, 'meta' | 'options' | 'help'>): void {
  console.log(`Usage: pnpm --filter @nestself/api exec tsx scripts/spikes/${def.meta.file} [options]`);
  console.log(`  ${def.meta.id}: ${def.meta.question}`);
  for (const line of def.help ?? []) console.log(`  ${line}`);
  console.log('Options:');
  for (const [name, option] of Object.entries(def.options ?? {})) {
    const value = option.type === 'string' ? ` <value>` : '';
    const fallback = option.default !== undefined && option.default !== false ? ` (default ${String(option.default)})` : '';
    console.log(`  --${name}${value}  ${option.description}${fallback}`);
  }
  console.log('  --help  Print this text and exit without calling AWS');
}

function parseSpikeArgs(def: Pick<SpikeDefinition, 'meta' | 'options' | 'help'>): SpikeArgs {
  const options: Record<string, { type: 'string' | 'boolean'; default?: string | boolean }> = { help: { type: 'boolean' } };
  for (const [name, option] of Object.entries(def.options ?? {})) {
    options[name] = option.default === undefined ? { type: option.type } : { type: option.type, default: option.default };
  }
  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options, strict: true, allowPositionals: false });
    const args = values as Record<string, string | boolean | undefined>;
    if (args.help) {
      printUsage(def);
      process.exit(0);
    }
    return args;
  } catch (error) {
    printUsage(def);
    console.error(`\n${describeError(error).message}`);
    process.exit(2);
  }
}

function emitResult(payload: Record<string, unknown>, exitCode: number): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => process.exit(exitCode));
}

/**
 * Runs a spike: guards, header, cleanup in `finally`, one JSON line at the end.
 * The process exits when this finishes.
 */
export function runSpike(def: SpikeDefinition): void {
  const args = parseSpikeArgs(def);
  const startedAt = new Date();
  const runId = newRunId();
  const log = (line: string): void => console.log(`[${new Date().toISOString().slice(11, 23)}] ${line}`);

  let env: SpikeEnv;
  try {
    env = loadSpikeEnv(def.requiredEnv);
  } catch (error) {
    if (!(error instanceof SpikeRefusal)) throw error;
    printHeader(def.meta, []);
    console.error(`REFUSED: ${error.message}`);
    emitResult({ spike: def.meta.id, runId, ok: false, outcome: 'refused', error: error.message }, 2);
    return;
  }

  printHeader(def.meta, [
    `Region:   ${env.region} (control, media and media pipelines)`,
    `Account:  ${env.accountId ?? 'unknown (CHIME_EVENTS_QUEUE_ARN not set)'}; credentials from ${env.credentials}`,
    `Run id:   ${runId} (ExternalMeetingId prefix ${EXTERNAL_MEETING_ID_PREFIX}${spikeNumber(def.meta)}-${runId})`,
  ]);

  const controller = new AbortController();
  const cleanup = new Cleanup(log);
  let interrupts = 0;
  process.on('SIGINT', () => {
    interrupts += 1;
    if (interrupts === 1) {
      console.error('\nInterrupted: finishing the current step, cleaning up and printing the result. Press Ctrl-C again to clean up and exit at once.');
      controller.abort();
      return;
    }
    console.error('Forced exit: running cleanup now.');
    void cleanup.runAll().finally(() => process.exit(130));
  });

  const ctx: SpikeContext = {
    meta: def.meta,
    runId,
    env,
    args,
    cleanup,
    signal: controller.signal,
    meetings: new ChimeSDKMeetingsClient({ region: env.region }),
    pipelines: new ChimeSDKMediaPipelinesClient({ region: env.region }),
    sqs: new SQSClient({ region: env.region }),
    log,
    sleep: async (ms) => {
      if (controller.signal.aborted) return false;
      try {
        await delay(ms, undefined, { signal: controller.signal });
        return true;
      } catch {
        return false;
      }
    },
  };

  void (async () => {
    let outcome: SpikeOutcome | undefined;
    let failure: ErrorInfo | undefined;
    let report: CleanupReport;
    try {
      outcome = await def.run(ctx);
    } catch (error) {
      failure = describeError(error);
      console.error(`FAILED: ${failure.name}: ${failure.message}`);
    } finally {
      console.log('--- cleanup ---');
      report = await cleanup.runAll();
    }
    if (!report.ok) {
      console.error('MANUAL CLEANUP NEEDED (run with the nestself-dev profile):');
      for (const item of report.failed) console.error(`  ${item.label}: ${item.manual ?? 'see the error above'}`);
    }
    for (const note of outcome?.notes ?? []) console.log(`note: ${note}`);
    const ok = !failure && outcome?.ok !== false && report.ok;
    const finishedAt = new Date();
    console.log('--- result (paste the next line into research/07-spikes.md) ---');
    emitResult(
      {
        spike: def.meta.id,
        runId,
        ok,
        outcome: failure ? 'error' : (outcome?.outcome ?? 'unknown'),
        region: env.region,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationSeconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
        measurements: outcome?.measurements ?? {},
        ...(failure ? { error: failure } : {}),
        cleanup: { ok: report.ok, done: report.done.length, failed: report.failed },
      },
      ok ? 0 : 1,
    );
  })();
}

/**
 * For spikes that only print instructions or a plan (SPIKE-CW-05, SPIKE-CW-06):
 * no AWS client, no credentials check, same header and JSON last line.
 */
export function runPrintOnlySpike(
  def: Pick<SpikeDefinition, 'meta' | 'options' | 'help'>,
  print: (args: SpikeArgs) => SpikeOutcome,
): void {
  const args = parseSpikeArgs(def);
  printHeader(def.meta, [`Region:   ${CHIME_REGION}`, 'Mode:     prints instructions only; makes no AWS call']);
  const outcome = print(args);
  console.log('--- result (paste the next line into research/07-spikes.md) ---');
  emitResult({ spike: def.meta.id, ok: true, outcome: outcome.outcome, measurements: outcome.measurements }, 0);
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export type SpikeFormat = 'consultation' | 'webinar';

/** Meeting features per format, D-CW-10 (never FHD video, CW-R-08). */
export const MEETING_FEATURES: Readonly<Record<SpikeFormat, MeetingFeaturesConfiguration>> = {
  consultation: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 4 },
  },
  webinar: {
    Audio: { EchoReduction: 'AVAILABLE' },
    Video: { MaxResolution: 'HD' },
    Content: { MaxResolution: 'FHD' },
    Attendee: { MaxCount: 250 },
  },
};

/** Attendee capabilities from D-CW-10 and D-CW-35. */
export const CAPABILITIES: Readonly<Record<'expert' | 'employee' | 'presenter' | 'webinarAttendee' | 'floor', AttendeeCapabilities>> = {
  expert: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' },
  employee: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'Receive' },
  presenter: { Audio: 'SendReceive', Video: 'SendReceive', Content: 'SendReceive' },
  webinarAttendee: { Audio: 'Receive', Video: 'Receive', Content: 'Receive' },
  floor: { Audio: 'SendReceive', Video: 'Receive', Content: 'Receive' },
};

/** `spike-cw-nn-<runId>-<suffix>`, at most 64 characters (OPS-01, OPS-02). */
export function spikeName(ctx: Pick<SpikeContext, 'meta' | 'runId'>, suffix: string): string {
  const name = `${EXTERNAL_MEETING_ID_PREFIX}${spikeNumber(ctx.meta)}-${ctx.runId}-${suffix}`;
  if (name.length > 64) throw new Error(`Generated id "${name}" exceeds 64 characters`);
  return name;
}

/** A fresh ClientRequestToken (2 to 64 characters of `[-_a-zA-Z0-9]`, OPS-01). */
export function newClientRequestToken(ctx: Pick<SpikeContext, 'meta'>): string {
  return `${EXTERNAL_MEETING_ID_PREFIX}${spikeNumber(ctx.meta)}-${randomUUID()}`;
}

export interface SpikeAttendeeSpec {
  /** Short key, part of the ExternalUserId (a synthetic participant id, never personal data, CW-R-03). */
  readonly key: string;
  readonly capabilities: AttendeeCapabilities;
}

export interface CreateSpikeMeetingOptions {
  readonly format: SpikeFormat;
  /** Suffix of the ExternalMeetingId, e.g. `a`, `control`. */
  readonly label: string;
  readonly attendees: readonly SpikeAttendeeSpec[];
  readonly maxCount?: number;
  /** Pass NotificationsConfiguration.SqsQueueArn (default: true when the queue ARN is known). */
  readonly notifications?: boolean;
  readonly clientRequestToken?: string;
  readonly externalMeetingId?: string;
}

/**
 * The adapter's CreateMeetingWithAttendees shape (guidelines section 3, D-CW-07,
 * D-CW-10, D-CW-11, D-CW-12): MediaRegion eu-central-1, ClientRequestToken,
 * ExternalMeetingId, features per format, NotificationsConfiguration to the
 * chime-events queue, TenantIds and the three permitted tags.
 */
export function buildCreateMeetingInput(ctx: SpikeContext, options: CreateSpikeMeetingOptions): CreateMeetingWithAttendeesCommandInput {
  const features = MEETING_FEATURES[options.format];
  const notifications = options.notifications ?? Boolean(ctx.env.queueArn);
  if (notifications && !ctx.env.queueArn) throw new SpikeRefusal('NotificationsConfiguration needs CHIME_EVENTS_QUEUE_ARN');
  return {
    ClientRequestToken: options.clientRequestToken ?? newClientRequestToken(ctx),
    ExternalMeetingId: options.externalMeetingId ?? spikeName(ctx, options.label),
    MediaRegion: CHIME_REGION,
    MeetingFeatures: options.maxCount === undefined ? features : { ...features, Attendee: { MaxCount: options.maxCount } },
    ...(notifications ? { NotificationsConfiguration: { SqsQueueArn: ctx.env.queueArn } } : {}),
    TenantIds: ['spike-cw'],
    Tags: [
      { Key: 'stage', Value: 'dev' },
      { Key: 'format', Value: options.format },
      { Key: 'orgId', Value: 'spike-cw' },
    ],
    Attendees: options.attendees.map((a) => ({ ExternalUserId: spikeName(ctx, a.key), Capabilities: a.capabilities })),
  };
}

export interface SpikeMeeting {
  readonly meeting: Meeting;
  readonly meetingId: string;
  /** Attendees by spec key. Contains join tokens: never print, only pass to the browser harness. */
  readonly attendees: ReadonlyMap<string, Attendee>;
  readonly errors: readonly CreateAttendeeError[];
}

export function meetingCleanupKey(meetingId: string): string {
  return `meeting:${meetingId}`;
}

/** Registers DeleteMeeting for a meeting id (tolerates a meeting that already ended). */
export function registerMeeting(ctx: SpikeContext, meetingId: string): void {
  const key = meetingCleanupKey(meetingId);
  if (ctx.cleanup.has(key)) return;
  ctx.cleanup.add(key, {
    label: `DeleteMeeting ${meetingId}`,
    manual: `aws chime-sdk-meetings delete-meeting --meeting-id ${meetingId} --region ${CHIME_REGION}`,
    run: async () => {
      try {
        await ctx.meetings.send(new DeleteMeetingCommand({ MeetingId: meetingId }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  });
}

export function mapAttendees(ctx: SpikeContext, specs: readonly SpikeAttendeeSpec[], attendees: readonly Attendee[] | undefined): Map<string, Attendee> {
  const byExternalId = new Map((attendees ?? []).map((a) => [a.ExternalUserId, a] as const));
  const result = new Map<string, Attendee>();
  for (const spec of specs) {
    const attendee = byExternalId.get(spikeName(ctx, spec.key));
    if (attendee) result.set(spec.key, attendee);
  }
  return result;
}

/** CreateMeetingWithAttendees with the adapter's shape; the meeting is deleted in cleanup. */
export async function createSpikeMeeting(ctx: SpikeContext, options: CreateSpikeMeetingOptions): Promise<SpikeMeeting> {
  const input = buildCreateMeetingInput(ctx, options);
  const response = await ctx.meetings.send(new CreateMeetingWithAttendeesCommand(input));
  const meetingId = response.Meeting?.MeetingId;
  if (!response.Meeting || !meetingId) throw new Error('CreateMeetingWithAttendees returned no meeting');
  registerMeeting(ctx, meetingId);
  const attendees = mapAttendees(ctx, options.attendees, response.Attendees);
  ctx.log(
    `created meeting ${meetingId} (${input.ExternalMeetingId}) with attendees ${[...attendees.entries()].map(([k, a]) => `${k}=${a.AttendeeId}`).join(', ')}`,
  );
  for (const error of response.Errors ?? []) ctx.log(`attendee error: ${error.ErrorCode ?? 'unknown'}: ${redact(error.ErrorMessage ?? '')}`);
  return { meeting: response.Meeting, meetingId, attendees, errors: response.Errors ?? [] };
}

export function requireAttendee(meeting: SpikeMeeting, key: string): Attendee {
  const attendee = meeting.attendees.get(key);
  if (!attendee?.AttendeeId) throw new Error(`Attendee "${key}" was not created on meeting ${meeting.meetingId}`);
  return attendee;
}

// ── Media capture pipelines (D-CW-18) ────────────────────────────────────────

/**
 * The webinar recording shape of D-CW-18: SelectedVideoStreams on the presenters,
 * CompositedVideo GridView with ContentShareLayout PresenterOnly at HD, audio
 * muxed into the composited video, individual video and content artifacts off.
 */
export function webinarCaptureConfiguration(selectedAttendeeIds: readonly string[]): ChimeSdkMeetingConfiguration {
  return {
    SourceConfiguration: { SelectedVideoStreams: { AttendeeIds: [...selectedAttendeeIds] } },
    ArtifactsConfiguration: {
      Audio: { MuxType: 'AudioWithCompositedVideo' },
      Video: { State: 'Disabled' },
      Content: { State: 'Disabled' },
      CompositedVideo: {
        Layout: 'GridView',
        Resolution: 'HD',
        GridViewConfiguration: {
          ContentShareLayout: 'PresenterOnly',
          PresenterOnlyConfiguration: { PresenterPosition: 'TopRight' },
        },
      },
    },
  };
}

/** `raw/spike-cw-nn/<runId>/<suffix>` under the recordings bucket (expired after 30 days, D-CW-18). */
export function recordingsPrefix(ctx: SpikeContext, suffix?: string): string {
  const base = `${RECORDINGS_RAW_PREFIX}/${EXTERNAL_MEETING_ID_PREFIX}${spikeNumber(ctx.meta)}/${ctx.runId}`;
  return suffix ? `${base}/${suffix}` : base;
}

export function bucketArn(bucket: string, prefix: string): string {
  return `arn:aws:s3:::${bucket}/${prefix}`;
}

export interface CapturePipeline {
  readonly pipelineId: string;
  readonly pipelineArn: string;
  /** Which source ARN form the API accepted. */
  readonly sourceArnStyle: 'documented' | 'meeting-arn';
  readonly sinkPrefix: string;
}

export function capturePipelineCleanupKey(pipelineId: string): string {
  return `capture:${pipelineId}`;
}

/**
 * CreateMediaCapturePipeline into the recordings bucket. Uses the documented source
 * ARN form `arn:aws:chime::<account>:meeting:<meetingId>` first and, if the API
 * rejects the source, retries once with the MeetingArn the meeting returned
 * (recorded as `sourceArnStyle`, an input for T-CW-2.5).
 */
export async function startCapturePipeline(
  ctx: SpikeContext,
  options: { meeting: Meeting; sinkPrefix: string; configuration: ChimeSdkMeetingConfiguration },
): Promise<CapturePipeline> {
  const { accountId, bucket } = ctx.env;
  if (!accountId || !bucket) throw new SpikeRefusal('Capture pipelines need CHIME_EVENTS_QUEUE_ARN (for the account id) and RECORDINGS_BUCKET');
  const meetingId = options.meeting.MeetingId ?? '';
  const attempts: { style: CapturePipeline['sourceArnStyle']; arn: string | undefined }[] = [
    { style: 'documented', arn: `arn:aws:chime::${accountId}:meeting:${meetingId}` },
    { style: 'meeting-arn', arn: options.meeting.MeetingArn },
  ];
  let lastError: unknown;
  for (const attempt of attempts) {
    if (!attempt.arn) continue;
    try {
      const response = await ctx.pipelines.send(
        new CreateMediaCapturePipelineCommand({
          SourceType: 'ChimeSdkMeeting',
          SourceArn: attempt.arn,
          SinkType: 'S3Bucket',
          SinkArn: bucketArn(bucket, options.sinkPrefix),
          ClientRequestToken: newClientRequestToken(ctx),
          ChimeSdkMeetingConfiguration: options.configuration,
        }),
      );
      const pipelineId = response.MediaCapturePipeline?.MediaPipelineId;
      const pipelineArn = response.MediaCapturePipeline?.MediaPipelineArn;
      if (!pipelineId || !pipelineArn) throw new Error('CreateMediaCapturePipeline returned no pipeline id');
      ctx.cleanup.add(capturePipelineCleanupKey(pipelineId), {
        label: `DeleteMediaCapturePipeline ${pipelineId}`,
        manual: `aws chime-sdk-media-pipelines delete-media-capture-pipeline --media-pipeline-id ${pipelineId} --region ${CHIME_REGION}`,
        run: async () => {
          try {
            await ctx.pipelines.send(new DeleteMediaCapturePipelineCommand({ MediaPipelineId: pipelineId }));
          } catch (error) {
            if (!isNotFound(error)) throw error;
          }
        },
      });
      ctx.log(`started capture pipeline ${pipelineId} on meeting ${meetingId} (source ARN form: ${attempt.style}) into s3://${bucket}/${options.sinkPrefix}`);
      return { pipelineId, pipelineArn, sourceArnStyle: attempt.style, sinkPrefix: options.sinkPrefix };
    } catch (error) {
      lastError = error;
      const info = describeError(error);
      const sourceRejected = info.name === 'BadRequestException' && /source/i.test(info.message);
      if (attempt.style === 'documented' && sourceRejected) {
        ctx.log(`documented source ARN rejected (${info.message}); retrying with the meeting's MeetingArn`);
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('CreateMediaCapturePipeline failed');
}

export interface StatusSample {
  readonly atSeconds: number;
  readonly status: string;
}

/** One GetMediaCapturePipeline: the status, or `NotFound` once the pipeline is gone. */
export async function captureStatus(ctx: SpikeContext, pipelineId: string): Promise<string> {
  try {
    const response = await ctx.pipelines.send(new GetMediaCapturePipelineCommand({ MediaPipelineId: pipelineId }));
    return response.MediaCapturePipeline?.Status ?? 'unknown';
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return 'NotFound';
  }
}

/** Polls GetMediaCapturePipeline until one of `until` (or `NotFound`) or the timeout. */
export async function waitForCaptureStatus(
  ctx: SpikeContext,
  pipelineId: string,
  options: { until: readonly MediaPipelineStatus[]; timeoutMs: number; intervalMs?: number },
): Promise<{ status: string; history: StatusSample[] }> {
  const started = Date.now();
  const history: StatusSample[] = [];
  let last = 'unknown';
  for (;;) {
    last = await captureStatus(ctx, pipelineId);
    if (history.at(-1)?.status !== last) {
      history.push({ atSeconds: Math.round((Date.now() - started) / 1000), status: last });
      ctx.log(`capture pipeline ${pipelineId}: ${last}`);
    }
    if (last === 'NotFound' || (options.until as readonly string[]).includes(last)) break;
    if (Date.now() - started >= options.timeoutMs) break;
    if (!(await ctx.sleep(options.intervalMs ?? 5000))) break;
  }
  return { status: last, history };
}

/** Registers DeleteMediaPipeline for a concatenation pipeline (tolerates one that finished). */
export function registerMediaPipeline(ctx: SpikeContext, pipelineId: string): void {
  ctx.cleanup.add(`pipeline:${pipelineId}`, {
    label: `DeleteMediaPipeline ${pipelineId}`,
    manual: `aws chime-sdk-media-pipelines delete-media-pipeline --media-pipeline-id ${pipelineId} --region ${CHIME_REGION}`,
    run: async () => {
      try {
        await ctx.pipelines.send(new DeleteMediaPipelineCommand({ MediaPipelineId: pipelineId }));
      } catch (error) {
        if (!isNotFound(error) && describeError(error).name !== 'ConflictException') throw error;
      }
    },
  });
}

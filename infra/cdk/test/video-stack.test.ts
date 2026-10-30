import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NestSelfVideoStack } from '../lib/video-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { getStageConfig } from '../lib/config.js';

const ACCOUNT = '111111111111';
const REGION = 'eu-central-1';
const sharedEnv = { account: ACCOUNT, region: REGION };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

/** Confused-deputy conditions every Chime service-principal grant must carry (OPS-16, WEB-27). */
const chimeSourceConditions = {
  StringEquals: { 'aws:SourceAccount': ACCOUNT },
  ArnLike: {
    'aws:SourceArn': { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:chime:${REGION}:${ACCOUNT}:*`]] },
  },
};

interface Statement {
  Sid?: string;
  Effect: string;
  Principal?: { Service?: string | string[] } | string;
  Action: string | string[];
  Resource?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function servicePrincipals(statement: Statement): string[] {
  if (typeof statement.Principal !== 'object') return [];
  return asArray(statement.Principal.Service);
}

/** Every statement of every resource of the given type, read from `propertyPath`. */
function statementsOf(template: Template, type: string, documentProperty: string): Statement[] {
  const resources = template.findResources(type);
  return Object.values(resources).flatMap((resource) => {
    const properties = (resource as { Properties: Record<string, { Statement: Statement[] }> }).Properties;
    return properties[documentProperty]?.Statement ?? [];
  });
}

function statementsFor(statements: Statement[], service: string): Statement[] {
  return statements.filter((s) => s.Effect === 'Allow' && servicePrincipals(s).includes(service));
}

function managedPolicyStatements(template: Template, policyName: string): Statement[] {
  const policies = template.findResources('AWS::IAM::ManagedPolicy', {
    Properties: { ManagedPolicyName: policyName },
  });
  const [policy] = Object.values(policies);
  expect(policy, `managed policy ${policyName}`).toBeDefined();
  return (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement;
}

function allowedActions(statements: Statement[]): string[] {
  return statements.filter((s) => s.Effect === 'Allow').flatMap((s) => asArray(s.Action));
}

function logicalIdOf(template: Template, type: string): string {
  const ids = Object.keys(template.findResources(type));
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

function synthDev(): { app: cdk.App; stack: NestSelfVideoStack; template: Template } {
  const app = new cdk.App();
  const stack = new NestSelfVideoStack(app, 'Test-dev-Video', {
    config: getStageConfig('dev'),
    env: sharedEnv,
    ...synthesizerProps,
  });
  return { app, stack, template: Template.fromStack(stack) };
}

describe('NestSelfVideoStack -- dev stage (own key)', () => {
  const { app, template } = synthDev();
  const keyId = logicalIdOf(template, 'AWS::KMS::Key');
  const keyArn = { 'Fn::GetAtt': [keyId, 'Arn'] };

  it('synthesizes a cloud assembly', () => {
    const assembly = app.synth();
    expect(assembly).toBeDefined();
    expect(assembly.getStackByName('Test-dev-Video')).toBeDefined();
  });

  it('creates its own KMS key with rotation when no platform key is passed', () => {
    template.resourceCountIs('AWS::KMS::Key', 1);
    template.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('encrypts the chime-events queue with the key, 60 s visibility, DLQ after 5 receives', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    const dlqId = Object.keys(queues).find(
      (id) => (queues[id] as { Properties: { QueueName: string } }).Properties.QueueName === 'nestself-dev-chime-events-dlq',
    );
    expect(dlqId).toBeDefined();

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'nestself-dev-chime-events',
      KmsMasterKeyId: keyArn,
      VisibilityTimeout: 60,
      RedrivePolicy: {
        deadLetterTargetArn: { 'Fn::GetAtt': [dlqId, 'Arn'] },
        maxReceiveCount: 5,
      },
    });
  });

  it('encrypts the dead-letter queue with the same key', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'nestself-dev-chime-events-dlq',
      KmsMasterKeyId: keyArn,
    });
  });

  it('lets meetings.chime.amazonaws.com send to the queue only from this account and region', () => {
    const statements = statementsFor(statementsOf(template, 'AWS::SQS::QueuePolicy', 'PolicyDocument'), 'meetings.chime.amazonaws.com');
    expect(statements).toHaveLength(1);
    expect(asArray(statements[0]!.Action).sort()).toEqual(['sqs:GetQueueUrl', 'sqs:SendMessage']);
    expect(statements[0]!.Condition).toEqual(chimeSourceConditions);
  });

  it('lets EventBridge send to the encrypted queue only from this account', () => {
    const statements = statementsFor(statementsOf(template, 'AWS::SQS::QueuePolicy', 'PolicyDocument'), 'events.amazonaws.com');
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement.Condition).toEqual({ StringEquals: { 'aws:SourceAccount': ACCOUNT } });
    }
  });

  it('lets the Chime services use the key with the confused-deputy conditions', () => {
    const keyStatements = statementsOf(template, 'AWS::KMS::Key', 'KeyPolicy');

    const meetings = statementsFor(keyStatements, 'meetings.chime.amazonaws.com');
    expect(meetings).toHaveLength(1);
    expect(asArray(meetings[0]!.Action).sort()).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    expect(meetings[0]!.Condition).toEqual(chimeSourceConditions);

    const pipelines = statementsFor(keyStatements, 'mediapipelines.chime.amazonaws.com');
    expect(pipelines).toHaveLength(1);
    expect(asArray(pipelines[0]!.Action).sort()).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    expect(pipelines[0]!.Condition).toEqual(chimeSourceConditions);
  });

  it('routes Chime meeting state changes from EventBridge to the queue', () => {
    const queues = template.findResources('AWS::SQS::Queue', {
      Properties: { QueueName: 'nestself-dev-chime-events' },
    });
    const [queueId] = Object.keys(queues);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['aws.chime'],
        'detail-type': ['Chime Meeting State Change'],
      },
      State: 'ENABLED',
      Targets: [{ Arn: { 'Fn::GetAtt': [queueId, 'Arn'] }, Id: 'Target0' }],
    });
  });

  it('encrypts the recordings bucket with the key and blocks public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `nestself-dev-recordings-${ACCOUNT}`,
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{
          BucketKeyEnabled: true,
          ServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: keyArn },
        }],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('expires raw capture segments after 30 days', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `nestself-dev-recordings-${ACCOUNT}`,
      LifecycleConfiguration: {
        Rules: [{ Id: 'ExpireRawSegments', Prefix: 'raw/', ExpirationInDays: 30, Status: 'Enabled' }],
      },
    });
  });

  it('writes recordings bucket access logs to a separate log bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `nestself-dev-recordings-${ACCOUNT}`,
      LoggingConfiguration: { LogFilePrefix: 'recordings/' },
    });
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `nestself-dev-recordings-logs-${ACCOUNT}`,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('encrypts the log bucket with SSE-S3 and expires logs after 365 days', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `nestself-dev-recordings-logs-${ACCOUNT}`,
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
      LifecycleConfiguration: {
        Rules: [{ Id: 'ExpireAccessLogs', ExpirationInDays: 365, Status: 'Enabled' }],
      },
    });
  });

  it('delivers access logs through a bucket policy, not an ACL', () => {
    const delivery = statementsFor(
      statementsOf(template, 'AWS::S3::BucketPolicy', 'PolicyDocument'),
      'logging.s3.amazonaws.com',
    );
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.Action).toBe('s3:PutObject');
    for (const bucket of Object.values(template.findResources('AWS::S3::Bucket'))) {
      expect((bucket as { Properties: Record<string, unknown> }).Properties['AccessControl']).toBeUndefined();
    }
  });

  it('lets mediapipelines.chime.amazonaws.com write, read and list the recordings bucket with the conditions', () => {
    const bucketStatements = statementsOf(template, 'AWS::S3::BucketPolicy', 'PolicyDocument');
    const pipelines = statementsFor(bucketStatements, 'mediapipelines.chime.amazonaws.com');
    expect(allowedActions(pipelines).sort()).toEqual(['s3:GetObject', 's3:ListBucket', 's3:PutObject', 's3:PutObjectAcl']);
    for (const statement of pipelines) {
      expect(statement.Condition).toEqual(chimeSourceConditions);
    }
  });

  it('denies non-TLS access to every bucket and queue', () => {
    const denies = [
      ...statementsOf(template, 'AWS::S3::BucketPolicy', 'PolicyDocument'),
      ...statementsOf(template, 'AWS::SQS::QueuePolicy', 'PolicyDocument'),
    ].filter((s) => s.Effect === 'Deny' && s.Condition?.['Bool']?.['aws:SecureTransport'] === 'false');
    // recordings bucket, log bucket, queue, dead-letter queue
    expect(denies).toHaveLength(4);
  });

  it('VideoApiPolicy grants the meeting actions on * and no media pipeline action', () => {
    const statements = managedPolicyStatements(template, 'nestself-dev-video-api');
    const actions = allowedActions(statements);
    expect(actions).toEqual(expect.arrayContaining([
      'chime:CreateMeeting',
      'chime:CreateMeetingWithAttendees',
      'chime:CreateAttendee',
      'chime:UpdateAttendeeCapabilities',
      'chime:DeleteAttendee',
      'chime:DeleteMeeting',
      'chime:GetMeeting',
    ]));
    // CW-R-79a: the API role never carries media-pipeline permissions.
    expect(actions.filter((a) => /MediaCapture|MediaPipeline|MediaConcatenation/.test(a))).toEqual([]);
    expect(actions.filter((a) => !a.startsWith('chime:'))).toEqual([]);
    for (const statement of statements) {
      expect(statement.Resource).toBe('*');
    }
  });

  it('VideoWorkerPolicy consumes the queue, runs media pipelines and reads and writes the bucket', () => {
    const statements = managedPolicyStatements(template, 'nestself-dev-video-worker');
    const actions = allowedActions(statements);
    expect(actions).toEqual(expect.arrayContaining([
      'sqs:ReceiveMessage',
      'sqs:DeleteMessage',
      'sqs:ChangeMessageVisibility',
      'chime:CreateMediaCapturePipeline',
      'chime:DeleteMediaCapturePipeline',
      'chime:GetMediaCapturePipeline',
      'chime:CreateMediaConcatenationPipeline',
      's3:PutObject',
      's3:GetObject',
      's3:ListBucket',
      's3:GetBucketPolicy',
      'kms:Decrypt',
      'kms:GenerateDataKey',
    ]));
  });

  it('VideoWorkerPolicy reads the bucket policy, as the media pipeline APIs require', () => {
    const statements = managedPolicyStatements(template, 'nestself-dev-video-worker');
    const bucketId = Object.keys(template.findResources('AWS::S3::Bucket', {
      Properties: { BucketName: `nestself-dev-recordings-${ACCOUNT}` },
    }))[0];
    const onBucket = statements.filter((s) => JSON.stringify(s.Resource) === JSON.stringify({ 'Fn::GetAtt': [bucketId, 'Arn'] }));
    expect(allowedActions(onBucket).sort()).toEqual(['s3:GetBucketPolicy', 's3:ListBucket']);
  });

  it('VideoWorkerPolicy may only look up and delete meetings (calls.cleanup, calls.reconcile)', () => {
    const actions = allowedActions(managedPolicyStatements(template, 'nestself-dev-video-worker'));
    expect(actions.filter((a) => /Meeting|Attendee/.test(a)).sort()).toEqual(['chime:DeleteMeeting', 'chime:GetMeeting']);
  });

  it('VideoWorkerPolicy keeps * resources to the media pipeline and meeting cleanup statements', () => {
    const statements = managedPolicyStatements(template, 'nestself-dev-video-worker');
    const wildcard = statements.filter((s) => asArray(s.Resource as string | string[]).includes('*'));
    expect(wildcard.map((s) => s.Sid).sort()).toEqual(['ChimeMediaPipelines', 'ChimeMeetingCleanup']);
    const cleanup = wildcard.find((s) => s.Sid === 'ChimeMeetingCleanup')!;
    expect(asArray(cleanup.Action).sort()).toEqual(['chime:DeleteMeeting', 'chime:GetMeeting']);
  });

  it('VideoWorkerPolicy may create only the media pipelines service-linked role', () => {
    const statements = managedPolicyStatements(template, 'nestself-dev-video-worker');
    const slr = statements.filter((s) => allowedActions([s]).includes('iam:CreateServiceLinkedRole'));
    expect(slr).toHaveLength(1);
    expect(slr[0]!.Action).toBe('iam:CreateServiceLinkedRole');
    expect(slr[0]!.Condition).toEqual({
      StringEquals: { 'iam:AWSServiceName': 'mediapipelines.chime.amazonaws.com' },
    });
    expect(JSON.stringify(slr[0]!.Resource)).toContain(
      ':iam::111111111111:role/aws-service-role/mediapipelines.chime.amazonaws.com/AWSServiceRoleForAmazonChimeSDKMediaPipelines',
    );
  });

  it('exports the five canonical outputs', () => {
    const outputs = template.findOutputs('*');
    expect(Object.keys(outputs).sort()).toEqual([
      'ChimeEventsQueueArn',
      'ChimeEventsQueueUrl',
      'RecordingsBucketName',
      'VideoApiPolicyArn',
      'VideoWorkerPolicyArn',
    ]);
  });

  it('exports the outputs under stage-scoped names', () => {
    const outputs = template.findOutputs('*') as Record<string, { Export: { Name: string } }>;
    expect(Object.fromEntries(Object.entries(outputs).map(([key, o]) => [key, o.Export.Name]))).toEqual({
      ChimeEventsQueueUrl: 'nestself-dev-chime-events-queue-url',
      ChimeEventsQueueArn: 'nestself-dev-chime-events-queue-arn',
      RecordingsBucketName: 'nestself-dev-recordings-bucket-name',
      VideoApiPolicyArn: 'nestself-dev-video-api-policy-arn',
      VideoWorkerPolicyArn: 'nestself-dev-video-worker-policy-arn',
    });
  });
});

interface AlarmProperties {
  AlarmName: string;
  AlarmDescription: string;
  ComparisonOperator: string;
  Threshold: number;
  EvaluationPeriods: number;
  TreatMissingData?: string;
  Namespace?: string;
  MetricName?: string;
  Statistic?: string;
  ExtendedStatistic?: string;
  Period?: number;
  Dimensions?: { Name: string; Value: unknown }[];
  AlarmActions?: unknown[];
  Metrics?: {
    Id: string;
    Expression?: string;
    ReturnData?: boolean;
    MetricStat?: { Metric: { Namespace: string; MetricName: string; Dimensions?: unknown[] }; Period: number; Stat: string };
  }[];
}

function alarms(template: Template): Record<string, AlarmProperties> {
  const resources = template.findResources('AWS::CloudWatch::Alarm') as Record<string, { Properties: AlarmProperties }>;
  return Object.fromEntries(Object.values(resources).map((r) => [r.Properties.AlarmName, r.Properties]));
}

describe('NestSelfVideoStack -- call alarms (D-CW-13, CW-R-40)', () => {
  const { template } = synthDev();
  const byName = alarms(template);
  const stageDimension = [{ Name: 'Stage', Value: 'dev' }];

  it('defines the three D-CW-13 alarms and the dead-letter queue alarm, and nothing else', () => {
    expect(Object.keys(byName).sort()).toEqual([
      'nestself-dev-chime-events-dlq-depth',
      'nestself-dev-video-join-failure-rate',
      'nestself-dev-video-meeting-failed-burst',
      'nestself-dev-video-meeting-start-p95',
    ]);
  });

  it('join failure rate: JoinFailures / JoinAttempts above 5 percent over 15 minutes', () => {
    const alarm = byName['nestself-dev-video-join-failure-rate']!;
    expect(alarm).toMatchObject({ ComparisonOperator: 'GreaterThanThreshold', Threshold: 5, EvaluationPeriods: 1, TreatMissingData: 'notBreaching' });
    const metrics = Object.fromEntries((alarm.Metrics ?? []).map((m) => [m.Id, m]));
    expect(metrics.failures?.MetricStat).toEqual({
      Metric: { Namespace: 'NestSelf/Video', MetricName: 'JoinFailures', Dimensions: stageDimension },
      Period: 900,
      Stat: 'Sum',
    });
    expect(metrics.attempts?.MetricStat).toEqual({
      Metric: { Namespace: 'NestSelf/Video', MetricName: 'JoinAttempts', Dimensions: stageDimension },
      Period: 900,
      Stat: 'Sum',
    });
    const expression = (alarm.Metrics ?? []).find((m) => m.ReturnData !== false);
    expect(expression?.Expression).toBe('IF(attempts > 0, 100 * failures / attempts, 0)');
  });

  it('p95 meetingStartDurationMs above 5 seconds', () => {
    expect(byName['nestself-dev-video-meeting-start-p95']).toMatchObject({
      Namespace: 'NestSelf/Video',
      MetricName: 'MeetingStartDurationMs',
      ExtendedStatistic: 'p95',
      Dimensions: stageDimension,
      Period: 900,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 5000,
      TreatMissingData: 'notBreaching',
    });
  });

  it('meetingFailed burst: more than 3 in 5 minutes', () => {
    expect(byName['nestself-dev-video-meeting-failed-burst']).toMatchObject({
      Namespace: 'NestSelf/Video',
      MetricName: 'MeetingFailed',
      Statistic: 'Sum',
      Dimensions: stageDimension,
      Period: 300,
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 3,
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching',
    });
  });

  it('dead-letter queue depth above 0 (CW-R-40)', () => {
    const dlq = template.findResources('AWS::SQS::Queue', { Properties: { QueueName: 'nestself-dev-chime-events-dlq' } });
    const dlqId = Object.keys(dlq)[0]!;
    expect(byName['nestself-dev-chime-events-dlq-depth']).toMatchObject({
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [dlqId, 'QueueName'] } }],
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 0,
    });
  });

  it('labels the D-CW-13 thresholds as planning assumptions', () => {
    for (const name of [
      'nestself-dev-video-join-failure-rate',
      'nestself-dev-video-meeting-start-p95',
      'nestself-dev-video-meeting-failed-burst',
    ]) {
      expect(byName[name]!.AlarmDescription, name).toMatch(/planning assumption/i);
    }
  });

  it('has no alarm actions until the stack gets a notification topic', () => {
    for (const alarm of Object.values(byName)) expect(alarm.AlarmActions ?? []).toEqual([]);
  });
});

describe('NestSelfVideoStack -- props', () => {
  it.each(['staging', 'production'] as const)('refuses the %s stage without the platform key', (stage) => {
    const app = new cdk.App();
    expect(() => new NestSelfVideoStack(app, `Test-${stage}-Video`, {
      config: getStageConfig(stage),
      env: sharedEnv,
      ...synthesizerProps,
    })).toThrow(/platformKey/);
  });
});

describe('NestSelfVideoStack -- staging (platform key from the security baseline)', () => {
  const app = new cdk.App();
  const config = getStageConfig('staging');
  const security = new NestSelfSecurityBaselineStack(app, 'Test-staging-Security', {
    config,
    env: sharedEnv,
    ...synthesizerProps,
  });
  const stack = new NestSelfVideoStack(app, 'Test-staging-Video', {
    config,
    platformKey: security.platformKey,
    env: sharedEnv,
    ...synthesizerProps,
  });
  const template = Template.fromStack(stack);

  it('creates no key of its own and synthesizes without a dependency cycle', () => {
    template.resourceCountIs('AWS::KMS::Key', 0);
    expect(app.synth()).toBeDefined();
  });

  it('encrypts the queue with the imported platform key', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'nestself-staging-chime-events',
      KmsMasterKeyId: { 'Fn::ImportValue': Match.stringLikeRegexp('PlatformKey') },
    });
  });

  it('adds the Chime statements to the platform key policy', () => {
    const keyStatements = statementsOf(Template.fromStack(security), 'AWS::KMS::Key', 'KeyPolicy');
    expect(statementsFor(keyStatements, 'meetings.chime.amazonaws.com')).toHaveLength(1);
    expect(statementsFor(keyStatements, 'mediapipelines.chime.amazonaws.com')).toHaveLength(1);
  });

  it('retains the recordings bucket outside dev', () => {
    template.hasResource('AWS::S3::Bucket', {
      Properties: { BucketName: `nestself-staging-recordings-${ACCOUNT}` },
      DeletionPolicy: 'Retain',
    });
  });
});

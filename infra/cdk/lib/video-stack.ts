import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cxapi from 'aws-cdk-lib/cx-api';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface VideoStackProps extends cdk.StackProps {
  readonly config: StageConfig;
  /**
   * The platform KMS key from the security baseline stack, required for
   * staging and production. The dev stage has no baseline stack and omits it;
   * the video stack then creates its own `VideoKey` (D-CW-31).
   */
  readonly platformKey?: kms.IKey;
}

/**
 * Prefix the capture pipeline writes 5-second segments under, expired after
 * 30 days (D-CW-18). The concatenated MP4 goes under `concatenated/` and is
 * kept (CW-R-79d).
 */
const RECORDINGS_RAW_PREFIX = 'raw/';

/**
 * NS-CALLS-01 video infrastructure (D-CW-31): the `chime-events` queue fed by
 * `CreateMeeting` notifications and an EventBridge backstop (D-CW-12), the
 * webinar recordings bucket (D-CW-18), and the managed policies for the API
 * and the worker.
 */
export class NestSelfVideoStack extends cdk.Stack {
  public readonly platformKey: kms.IKey;
  public readonly chimeEventsQueue: sqs.Queue;
  public readonly chimeEventsDlq: sqs.Queue;
  public readonly recordingsBucket: s3.Bucket;
  public readonly videoApiPolicy: iam.ManagedPolicy;
  public readonly videoWorkerPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: VideoStackProps) {
    super(scope, id, props);

    // Two feature flags this stack relies on, set before any child exists so
    // the result does not depend on cdk.json:
    // - the EventBridge SQS target conditions its grant on aws:SourceAccount
    //   only with this flag; without it an encrypted queue lets
    //   events.amazonaws.com send from any account;
    // - server access logs are delivered through a bucket policy instead of
    //   the legacy LogDeliveryWrite ACL.
    this.node.setContext(cxapi.EVENTS_TARGET_QUEUE_SAME_ACCOUNT, true);
    this.node.setContext(cxapi.S3_SERVER_ACCESS_LOGS_USE_BUCKET_POLICY, true);

    const { config } = props;
    const stage = config.stage;
    if (stage !== 'dev' && !props.platformKey) {
      throw new Error(`NestSelfVideoStack: the ${stage} stage requires platformKey from the security baseline stack.`);
    }
    const removalPolicy = config.removalPolicy === 'destroy'
      ? cdk.RemovalPolicy.DESTROY
      : cdk.RemovalPolicy.RETAIN;

    // ── Key ──────────────────────────────────────────────────────────
    this.platformKey = props.platformKey ?? new kms.Key(this, 'VideoKey', {
      alias: `alias/nestself-${stage}-video`,
      description: `NestSelf ${stage} video key (chime-events queues, recordings bucket)`,
      enableKeyRotation: true,
      removalPolicy,
    });
    const key = this.platformKey;

    // Confused-deputy protection for the Chime service principals (OPS-16,
    // WEB-27). Every Chime call is made in eu-central-1, so the source ARN is
    // pinned to the stack region rather than the documentation's `*`.
    const chimeSourceConditions = {
      StringEquals: { 'aws:SourceAccount': this.account },
      ArnLike: { 'aws:SourceArn': `arn:${cdk.Aws.PARTITION}:chime:${this.region}:${this.account}:*` },
    };

    // ── chime-events queue (D-CW-12) ─────────────────────────────────
    this.chimeEventsDlq = new sqs.Queue(this, 'ChimeEventsDlq', {
      queueName: `nestself-${stage}-chime-events-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    this.chimeEventsQueue = new sqs.Queue(this, 'ChimeEventsQueue', {
      queueName: `nestself-${stage}-chime-events`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      enforceSSL: true,
      visibilityTimeout: cdk.Duration.seconds(60),
      receiveMessageWaitTime: cdk.Duration.seconds(20),
      deadLetterQueue: { queue: this.chimeEventsDlq, maxReceiveCount: 5 },
    });

    // CreateMeeting NotificationsConfiguration.SqsQueueArn delivers here (OPS-16).
    this.chimeEventsQueue.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'ChimeMeetingsSendEvents',
      principals: [new iam.ServicePrincipal('meetings.chime.amazonaws.com')],
      actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
      resources: [this.chimeEventsQueue.queueArn],
      conditions: chimeSourceConditions,
    }));
    // SSE queues also need the sender to use the key (OPS-16).
    // SPIKE-CW-07 must confirm that direct SQS delivery from CreateMeeting
    // works with these conditions; if it does not, drop the conditions on this
    // one statement (the queue policy keeps its own).
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'ChimeMeetingsEncryptEvents',
      principals: [new iam.ServicePrincipal('meetings.chime.amazonaws.com')],
      actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
      resources: ['*'],
      conditions: chimeSourceConditions,
    }));

    // EventBridge backstop: same events, same queue (D-CW-12, OPS-09).
    new events.Rule(this, 'ChimeMeetingStateChangeRule', {
      ruleName: `nestself-${stage}-chime-meeting-state-change`,
      description: 'Chime SDK meeting lifecycle events to the chime-events queue (backstop to CreateMeeting notifications)',
      eventPattern: {
        source: ['aws.chime'],
        detailType: ['Chime Meeting State Change'],
      },
      targets: [new targets.SqsQueue(this.chimeEventsQueue)],
    });

    // ── Recordings bucket (D-CW-18) ──────────────────────────────────
    // Server access logs need an SSE-S3 target bucket (SSE-KMS is not
    // supported for log delivery).
    const accessLogsBucket = new s3.Bucket(this, 'RecordingsAccessLogsBucket', {
      bucketName: `nestself-${stage}-recordings-logs-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ id: 'ExpireAccessLogs', expiration: cdk.Duration.days(365) }],
      removalPolicy,
    });

    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      bucketName: `nestself-${stage}-recordings-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'recordings/',
      lifecycleRules: [{
        id: 'ExpireRawSegments',
        prefix: RECORDINGS_RAW_PREFIX,
        expiration: cdk.Duration.days(30),
      }],
      removalPolicy,
    });

    // Capture writes segments; concatenation reads and lists them from the
    // same bucket and writes the MP4 back (WEB-27, WEB-29).
    this.recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'ChimeMediaPipelinesObjects',
      principals: [new iam.ServicePrincipal('mediapipelines.chime.amazonaws.com')],
      actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:GetObject'],
      resources: [this.recordingsBucket.arnForObjects('*')],
      conditions: chimeSourceConditions,
    }));
    this.recordingsBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'ChimeMediaPipelinesList',
      principals: [new iam.ServicePrincipal('mediapipelines.chime.amazonaws.com')],
      actions: ['s3:ListBucket'],
      resources: [this.recordingsBucket.bucketArn],
      conditions: chimeSourceConditions,
    }));
    // SSE-KMS: GenerateDataKey to write segments, Decrypt to concatenate them.
    key.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'ChimeMediaPipelinesRecordings',
      principals: [new iam.ServicePrincipal('mediapipelines.chime.amazonaws.com')],
      actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
      resources: ['*'],
      conditions: chimeSourceConditions,
    }));

    // ── Managed policies (D-CW-31) ───────────────────────────────────
    // API: meeting and attendee lifecycle only. Never media pipelines
    // (CW-R-79a). TagResource because CreateMeeting carries the stage,
    // format and orgId tags (D-CW-11, OPS-22).
    this.videoApiPolicy = new iam.ManagedPolicy(this, 'VideoApiPolicy', {
      managedPolicyName: `nestself-${stage}-video-api`,
      description: 'NestSelf API: Chime SDK meetings and attendees',
      statements: [
        new iam.PolicyStatement({
          sid: 'ChimeMeetings',
          actions: [
            'chime:CreateMeeting',
            'chime:CreateMeetingWithAttendees',
            'chime:CreateAttendee',
            'chime:UpdateAttendeeCapabilities',
            'chime:DeleteAttendee',
            'chime:DeleteMeeting',
            'chime:GetMeeting',
            'chime:TagResource',
          ],
          resources: ['*'],
        }),
      ],
    });
    Validations.of(this.videoApiPolicy).acknowledge({
      id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]',
      reason: 'D-CW-31, OPS-21: Chime SDK meetings actions do not support resource-level permissions.',
    });

    // Worker: consume chime-events, clean up meetings, run capture and
    // concatenation pipelines, read and write the recordings bucket
    // (D-CW-09, D-CW-18, CW-R-79d).
    this.videoWorkerPolicy = new iam.ManagedPolicy(this, 'VideoWorkerPolicy', {
      managedPolicyName: `nestself-${stage}-video-worker`,
      description: 'NestSelf worker: chime-events queue, meeting cleanup, Chime SDK media pipelines, recordings bucket',
      statements: [
        new iam.PolicyStatement({
          sid: 'ConsumeChimeEvents',
          actions: [
            'sqs:ReceiveMessage',
            'sqs:DeleteMessage',
            'sqs:ChangeMessageVisibility',
            'sqs:GetQueueAttributes',
            'sqs:GetQueueUrl',
          ],
          resources: [this.chimeEventsQueue.queueArn],
        }),
        new iam.PolicyStatement({
          sid: 'ChimeMediaPipelines',
          actions: [
            'chime:CreateMediaCapturePipeline',
            'chime:GetMediaCapturePipeline',
            'chime:DeleteMediaCapturePipeline',
            'chime:CreateMediaConcatenationPipeline',
            'chime:GetMediaPipeline',
            'chime:DeleteMediaPipeline',
          ],
          resources: ['*'],
        }),
        // calls.cleanup and calls.reconcile run in the worker and look up or
        // end meetings (D-CW-09); meetings actions have no resource-level
        // permissions (OPS-21).
        new iam.PolicyStatement({
          sid: 'ChimeMeetingCleanup',
          actions: ['chime:GetMeeting', 'chime:DeleteMeeting'],
          resources: ['*'],
        }),
        // The first pipeline in an account creates the media pipelines
        // service-linked role (WEB-28).
        new iam.PolicyStatement({
          sid: 'ChimeMediaPipelinesServiceLinkedRole',
          actions: ['iam:CreateServiceLinkedRole'],
          resources: [
            `arn:${cdk.Aws.PARTITION}:iam::${this.account}:role/aws-service-role/mediapipelines.chime.amazonaws.com/AWSServiceRoleForAmazonChimeSDKMediaPipelines`,
          ],
          conditions: { StringEquals: { 'iam:AWSServiceName': 'mediapipelines.chime.amazonaws.com' } },
        }),
        new iam.PolicyStatement({
          sid: 'RecordingsObjects',
          actions: ['s3:PutObject', 's3:GetObject'],
          resources: [this.recordingsBucket.arnForObjects('*')],
        }),
        // The media pipeline APIs read the sink bucket's policy as the caller.
        new iam.PolicyStatement({
          sid: 'RecordingsBucket',
          actions: ['s3:ListBucket', 's3:GetBucketPolicy'],
          resources: [this.recordingsBucket.bucketArn],
        }),
        new iam.PolicyStatement({
          sid: 'VideoKey',
          actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
          resources: [key.keyArn],
        }),
      ],
    });
    const recordingsBucketLogicalId = this.getLogicalId(
      this.recordingsBucket.node.defaultChild as s3.CfnBucket,
    );
    Validations.of(this.videoWorkerPolicy).acknowledge(
      {
        id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]',
        reason: 'D-CW-31, OPS-21, OPS-22: ChimeMediaPipelines (media pipeline create actions) and ChimeMeetingCleanup (GetMeeting, DeleteMeeting) have no resource-level permissions.',
      },
      {
        id: `AwsSolutions::AwsSolutions-IAM5[Resource::<${recordingsBucketLogicalId}.Arn>/*]`,
        reason: 'D-CW-18: Recording object keys are created per webinar at run time; the wildcard covers objects of this one bucket only.',
      },
    );

    // ── Outputs (D-CW-31, CW-R-66) ───────────────────────────────────
    new cdk.CfnOutput(this, 'ChimeEventsQueueUrl', {
      value: this.chimeEventsQueue.queueUrl,
      exportName: `nestself-${stage}-chime-events-queue-url`,
      description: 'CHIME_EVENTS_QUEUE_URL',
    });
    new cdk.CfnOutput(this, 'ChimeEventsQueueArn', {
      value: this.chimeEventsQueue.queueArn,
      exportName: `nestself-${stage}-chime-events-queue-arn`,
      description: 'CHIME_EVENTS_QUEUE_ARN',
    });
    new cdk.CfnOutput(this, 'RecordingsBucketName', {
      value: this.recordingsBucket.bucketName,
      exportName: `nestself-${stage}-recordings-bucket-name`,
      description: 'RECORDINGS_BUCKET',
    });
    new cdk.CfnOutput(this, 'VideoApiPolicyArn', {
      value: this.videoApiPolicy.managedPolicyArn,
      exportName: `nestself-${stage}-video-api-policy-arn`,
      description: 'Managed policy for the API task role (dev: the developer identity)',
    });
    new cdk.CfnOutput(this, 'VideoWorkerPolicyArn', {
      value: this.videoWorkerPolicy.managedPolicyArn,
      exportName: `nestself-${stage}-video-worker-policy-arn`,
      description: 'Managed policy for the worker task role (dev: the developer identity)',
    });
  }
}

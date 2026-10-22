import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface SecurityBaselineStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

export class NestSelfSecurityBaselineStack extends cdk.Stack {
  public readonly platformKey: kms.Key;
  public readonly professionalKey: kms.Key;
  public readonly hostedZone: route53.HostedZone;

  constructor(scope: Construct, id: string, props: SecurityBaselineStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // ── KMS keys ─────────────────────────────────────────────────
    this.platformKey = new kms.Key(this, 'PlatformKey', {
      alias: 'alias/nestself-platform',
      description: `NestSelf ${stage} platform encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.professionalKey = new kms.Key(this, 'ProfessionalKey', {
      alias: 'alias/nestself-professional',
      description: `NestSelf ${stage} professional content encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ── Route 53 hosted zone (created, not looked up) ────────────
    this.hostedZone = new route53.HostedZone(this, 'HostedZone', {
      zoneName: config.domainName,
    });

    // ── CloudTrail ───────────────────────────────────────────────
    const trailBucket = new s3.Bucket(this, 'TrailBucket', {
      bucketName: `nestself-${stage}-cloudtrail-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(365) }],
    });

    new cloudtrail.Trail(this, 'Trail', {
      trailName: `nestself-${stage}`,
      bucket: trailBucket,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: true,
      enableFileValidation: true,
    });

    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-S1', reason: 'D-31: CloudTrail bucket is the audit source; separate access logging not needed.' },
      { id: 'AwsSolutions::AwsSolutions-IAM5', reason: 'D-30: CloudTrail service role uses managed policies with resource wildcards.' },
      { id: 'AwsSolutions::AwsSolutions-KMS5', reason: 'D-27: KMS keys have automatic rotation enabled.' },
      { id: 'AwsSolutions::AwsSolutions-CT4', reason: 'D-31: Log file validation is on; KMS encryption of trail is phase 2.' },
    );
  }
}

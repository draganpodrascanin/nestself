import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface CiStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

/**
 * NestSelfCiStack: GitHub Actions OIDC provider and deploy role with
 * least-privilege policies for ECR push, ECS update, S3 sync, CloudFront
 * invalidation, run-task for migrate and CDK deploy via bootstrap roles.
 * [D-30, OPS-R-07, S-88]
 */
export class NestSelfCiStack extends cdk.Stack {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // GitHub repository from context or placeholder
    const githubRepo = (
      this.node.tryGetContext('githubRepo') as string | undefined
    ) ?? 'nestself/nestself';

    // ── OIDC provider ────────────────────────────────────────────
    // Only one OIDC provider per account for GitHub Actions; use
    // fromOpenIdConnectProviderArn if it already exists.
    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: [
        '6938fd4d98bab03faadb97b34396831e3780aea1',
        '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
      ],
    });

    // ── Trust policy ─────────────────────────────────────────────
    // Staging: main branch. Production: v* tags. [7.12.2]
    const subClaims = stage === 'production'
      ? [`repo:${githubRepo}:ref:refs/tags/v*`]
      : [
          `repo:${githubRepo}:ref:refs/heads/main`,
          `repo:${githubRepo}:pull_request`,
        ];

    const principal = new iam.WebIdentityPrincipal(
      oidcProvider.openIdConnectProviderArn,
      {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': subClaims,
        },
      },
    );

    // ── Deploy role ──────────────────────────────────────────────
    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: `nestself-${stage}-github-deploy`,
      assumedBy: principal,
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // ECR: push images
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrPush',
        actions: [
          'ecr:GetAuthorizationToken',
        ],
        resources: ['*'],
      }),
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrRepoActions',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:CompleteLayerUpload',
          'ecr:InitiateLayerUpload',
          'ecr:PutImage',
          'ecr:UploadLayerPart',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:DescribeImageScanFindings',
          'ecr:DescribeImages',
        ],
        resources: [
          `arn:${this.partition}:ecr:${this.region}:${this.account}:repository/nestself-${stage}-*`,
        ],
      }),
    );

    // ECS: update services, run tasks, describe tasks
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsServiceUpdate',
        actions: [
          'ecs:UpdateService',
          'ecs:DescribeServices',
          'ecs:RegisterTaskDefinition',
          'ecs:DescribeTaskDefinition',
          'ecs:RunTask',
          'ecs:DescribeTasks',
          'ecs:ListTasks',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: { 'aws:ResourceTag/aws:ecs:clusterName': `nestself-${stage}` },
        },
      }),
    );

    // ECS needs unconstrained access for register-task-definition and run-task
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcsGlobal',
        actions: [
          'ecs:RegisterTaskDefinition',
          'ecs:DescribeTaskDefinition',
          'ecs:RunTask',
          'ecs:DescribeTasks',
        ],
        resources: ['*'],
      }),
    );

    // Pass role for ECS task execution and task roles
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PassRole',
        actions: ['iam:PassRole'],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/nestself-${stage}-*`,
        ],
      }),
    );

    // S3: sync SPA bundles
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'S3Sync',
        actions: [
          's3:PutObject',
          's3:DeleteObject',
          's3:GetObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [
          `arn:${this.partition}:s3:::nestself-${stage}-spa-*`,
          `arn:${this.partition}:s3:::nestself-${stage}-spa-*/*`,
        ],
      }),
    );

    // CloudFront: create invalidations
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudFrontInvalidation',
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:${this.partition}:cloudfront::${this.account}:distribution/*`,
        ],
      }),
    );

    // ECR scan: wait for image scan
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'EcrScan',
        actions: [
          'ecr:StartImageScan',
          'ecr:DescribeImageScanFindings',
          'ecr:DescribeImages',
        ],
        resources: [
          `arn:${this.partition}:ecr:${this.region}:${this.account}:repository/nestself-${stage}-*`,
        ],
      }),
    );

    // CDK deploy: assume bootstrap roles
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:${this.partition}:iam::${this.account}:role/cdk-*`,
        ],
      }),
    );

    // CloudFormation: describe stacks (for deploy wait)
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CfnDescribe',
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
        ],
        resources: [
          `arn:${this.partition}:cloudformation:${this.region}:${this.account}:stack/NestSelf-${stage}-*/*`,
        ],
      }),
    );

    // ── Outputs ──────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.deployRole.roleArn,
      exportName: `nestself-${stage}-deploy-role-arn`,
      description: 'DEPLOY_ROLE_ARN for GitHub Actions',
    });

    new cdk.CfnOutput(this, 'OidcProviderArn', {
      value: oidcProvider.openIdConnectProviderArn,
      exportName: `nestself-${stage}-oidc-provider-arn`,
    });

    // ── cdk-nag acknowledgments ──────────────────────────────────
    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-IAM5', reason: 'D-30: Deploy role uses wildcards scoped to stage-prefixed resources (e.g. nestself-staging-*). ECS register-task-definition requires * resource.' },
      { id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]', reason: 'D-30: ECS global actions (RegisterTaskDefinition, RunTask) require * resource per AWS documentation.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:ecr:${this.region}:${this.account}:repository/nestself-${stage}-*]`, reason: 'D-30: ECR actions scoped to stage-prefixed repositories.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:iam::${this.account}:role/nestself-${stage}-*]`, reason: 'D-30: PassRole scoped to stage-prefixed task roles.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::nestself-${stage}-spa-*]`, reason: 'D-30: S3 sync scoped to SPA buckets.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::nestself-${stage}-spa-*/*]`, reason: 'D-30: S3 object actions scoped to SPA bucket contents.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:cloudfront::${this.account}:distribution/*]`, reason: 'D-30: CloudFront invalidation requires distribution/* because IDs are unknown at synth.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:iam::${this.account}:role/cdk-*]`, reason: 'D-30: CDK bootstrap roles follow the cdk-* naming convention.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:cloudformation:${this.region}:${this.account}:stack/NestSelf-${stage}-*/*]`, reason: 'D-30: CloudFormation describe scoped to stage-prefixed stacks.' },
      { id: 'AwsSolutions::AwsSolutions-IAM4', reason: 'D-30: OIDC provider custom resource uses CDK-managed Lambda execution role.' },
      { id: 'AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: 'D-30: OIDC provider custom resource Lambda uses the AWS-managed basic execution role.' },
      { id: 'AwsSolutions::AwsSolutions-L1', reason: 'D-30: OIDC provider custom resource Lambda runtime is managed by CDK.' },
    );
  }
}

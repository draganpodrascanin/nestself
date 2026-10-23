import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

export interface EcsTaskRolesProps {
  readonly stage: string;
  readonly region: string;
  readonly account: string;
  readonly partition: string;
  readonly userPoolArn: string;
}

/**
 * Creates ECS task execution and task roles for the compute stack.
 * Extracted to keep compute-stack.ts under 400 lines.
 */
export class EcsTaskRoles extends cdk.Resource {
  public readonly executionRole: iam.Role;
  public readonly apiTaskRole: iam.Role;
  public readonly workerTaskRole: iam.Role;
  public readonly marketingTaskRole: iam.Role;

  constructor(scope: Construct, id: string, props: EcsTaskRolesProps) {
    super(scope, id);

    const { stage, region, account, partition, userPoolArn } = props;

    // ── Shared execution role ────────────────────────────────────
    this.executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: `nestself-${stage}-ecs-execution`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // Grant reading secrets at task launch
    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:${partition}:secretsmanager:${region}:${account}:secret:nestself-${stage}/*`,
        ],
      }),
    );

    // ── API task role ────────────────────────────────────────────
    this.apiTaskRole = new iam.Role(this, 'ApiTaskRole', {
      roleName: `nestself-${stage}-api-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Cognito admin calls for the BFF
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminInitiateAuth',
          'cognito-idp:AdminRespondToAuthChallenge',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminDisableUser',
          'cognito-idp:AdminEnableUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUserGlobalSignOut',
          'cognito-idp:GetTokensFromRefreshToken',
          'cognito-idp:RevokeToken',
          'cognito-idp:DescribeUserPoolClient',
        ],
        resources: [userPoolArn],
      }),
    );

    // CloudWatch embedded metric format
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': `nestself/${stage}` },
        },
      }),
    );

    // SES for transactional email
    this.apiTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:${partition}:ses:${region}:${account}:identity/*`,
        ],
      }),
    );

    // ── Worker task role ─────────────────────────────────────────
    this.workerTaskRole = new iam.Role(this, 'WorkerTaskRole', {
      roleName: `nestself-${stage}-worker-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': `nestself/${stage}` },
        },
      }),
    );

    this.workerTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:${partition}:ses:${region}:${account}:identity/*`,
        ],
      }),
    );

    // ── Marketing task role ──────────────────────────────────────
    this.marketingTaskRole = new iam.Role(this, 'MarketingTaskRole', {
      roleName: `nestself-${stage}-marketing-task`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
  }
}

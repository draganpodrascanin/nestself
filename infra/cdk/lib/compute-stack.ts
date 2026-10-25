import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';
import { EcsTaskRoles } from './constructs/ecs-task-roles.js';

export interface ComputeStackProps extends cdk.StackProps {
  readonly config: StageConfig;
  readonly vpc: ec2.IVpc;
  readonly platformKey: kms.IKey;
}

/**
 * NestSelfComputeStack: ECS cluster, Fargate services (api, worker, marketing),
 * migrate task definition, ALB, ECR repositories and security groups.
 * [D-24, D-08, D-30]
 */
export class NestSelfComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly apiRepo: ecr.Repository;
  public readonly marketingRepo: ecr.Repository;
  public readonly apiService: ecs.FargateService;
  public readonly albListener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, vpc, platformKey } = props;
    const stage = config.stage;
    const isProd = stage === 'production';
    const logRetention = isProd
      ? logs.RetentionDays.ONE_MONTH
      : logs.RetentionDays.ONE_WEEK;

    // ── ECR repositories ─────────────────────────────────────────
    this.apiRepo = new ecr.Repository(this, 'ApiRepo', {
      repositoryName: `nestself-${stage}-api`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: platformKey,
    });

    this.marketingRepo = new ecr.Repository(this, 'MarketingRepo', {
      repositoryName: `nestself-${stage}-marketing`,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: ecr.RepositoryEncryption.KMS,
      encryptionKey: platformKey,
    });

    // ── ECS cluster ──────────────────────────────────────────────
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `nestself-${stage}`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    // ── Security groups ──────────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc, description: `nestself-${stage} ALB security group`,
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const apiSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc, description: `nestself-${stage} API service security group`,
      allowAllOutbound: true,
    });
    apiSg.addIngressRule(albSg, ec2.Port.tcp(4000), 'ALB to API');

    const workerSg = new ec2.SecurityGroup(this, 'WorkerSg', {
      vpc, description: `nestself-${stage} worker service security group`,
      allowAllOutbound: true,
    });

    const marketingSg = new ec2.SecurityGroup(this, 'MarketingSg', {
      vpc, description: `nestself-${stage} marketing service security group`,
      allowAllOutbound: true,
    });
    marketingSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB to Marketing');

    // ── ALB ──────────────────────────────────────────────────────
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `nestself-${stage}`,
      vpc, internetFacing: true, securityGroup: albSg,
    });

    this.albListener = this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain', messageBody: 'Not Found',
      }),
    });

    // ── IAM roles (extracted construct) ──────────────────────────
    const roles = new EcsTaskRoles(this, 'Roles', {
      stage,
      region: this.region,
      account: this.account,
      partition: this.partition,
      userPoolArn: cdk.Fn.importValue(`nestself-${stage}-cognito-user-pool-arn`),
    });

    this.apiRepo.grantPull(roles.executionRole);
    this.marketingRepo.grantPull(roles.executionRole);

    // ── Import secrets ───────────────────────────────────────────
    const webClientSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'WebClientSecret',
      cdk.Fn.importValue(`nestself-${stage}-cognito-web-client-secret-arn`),
    );
    const sessionKey = secretsmanager.Secret.fromSecretCompleteArn(
      this, 'SessionKey',
      cdk.Fn.importValue(`nestself-${stage}-session-encryption-key-arn`),
    );
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'DbSecret', `nestself-${stage}/rds/credentials`,
    );
    const valkeySecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'ValkeySecret', `nestself-${stage}/valkey/auth-token`,
    );

    const sharedEnv: Record<string, string> = {
      NODE_ENV: isProd ? 'production' : 'development',
      STAGE: stage,
      AUTH_MODE: 'cognito',
      COGNITO_REGION: this.region,
      COGNITO_USER_POOL_ID: cdk.Fn.importValue(`nestself-${stage}-cognito-user-pool-id`),
      COGNITO_WEB_CLIENT_ID: cdk.Fn.importValue(`nestself-${stage}-cognito-web-client-id`),
      COGNITO_MOBILE_CLIENT_ID: cdk.Fn.importValue(`nestself-${stage}-cognito-mobile-client-id`),
      COGNITO_DOMAIN: cdk.Fn.importValue(`nestself-${stage}-cognito-domain`),
      COGNITO_ISSUER: cdk.Fn.importValue(`nestself-${stage}-cognito-issuer`),
      // Required by the API in cognito mode: SSO redirects and the discover start URL (docs/auth/implementation.md 22).
      WORKSPACE_URL: config.workspaceUrl,
      ADMIN_URL: config.adminUrl,
      API_PUBLIC_URL: config.apiPublicUrl,
    };

    const sharedSecrets: Record<string, ecs.Secret> = {
      COGNITO_WEB_CLIENT_SECRET: ecs.Secret.fromSecretsManager(webClientSecret),
      SESSION_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(sessionKey),
      DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret),
      REDIS_URL: ecs.Secret.fromSecretsManager(valkeySecret),
    };

    // ── API task definition and service ──────────────────────────
    const apiTaskDef = new ecs.FargateTaskDefinition(this, 'ApiTaskDef', {
      family: `nestself-${stage}-api`, cpu: 512, memoryLimitMiB: 1024,
      executionRole: roles.executionRole, taskRole: roles.apiTaskRole,
    });

    apiTaskDef.addContainer('api', {
      containerName: 'api',
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      portMappings: [{ containerPort: 4000 }],
      environment: sharedEnv,
      secrets: sharedSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: new logs.LogGroup(this, 'ApiLogGroup', {
          logGroupName: `/ecs/nestself-${stage}-api`,
          retention: logRetention, removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        streamPrefix: 'api',
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:4000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30), timeout: cdk.Duration.seconds(5),
        retries: 3, startPeriod: cdk.Duration.seconds(60),
      },
    });

    this.apiService = new ecs.FargateService(this, 'ApiService', {
      serviceName: `nestself-${stage}-api`, cluster: this.cluster,
      taskDefinition: apiTaskDef, desiredCount: config.apiMinTasks,
      securityGroups: [apiSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: !isProd,
    });

    const apiTg = this.albListener.addTargets('ApiTargets', {
      port: 4000, protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.apiService],
      healthCheck: {
        path: '/api/health', interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2, unhealthyThresholdCount: 3,
      },
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      priority: 10, stickinessCookieDuration: cdk.Duration.days(1),
    });

    // Duration-based stickiness for Socket.IO [D-08]
    const cfnApiTg = apiTg.node.defaultChild as elbv2.CfnTargetGroup;
    cfnApiTg.addPropertyOverride('TargetGroupAttributes', [
      { Key: 'stickiness.enabled', Value: 'true' },
      { Key: 'stickiness.type', Value: 'lb_cookie' },
      { Key: 'stickiness.lb_cookie.duration_seconds', Value: '86400' },
    ]);

    // API autoscaling [INFRA-R-07]
    const apiScaling = this.apiService.autoScaleTaskCount({
      minCapacity: config.apiMinTasks, maxCapacity: config.apiMinTasks * 4,
    });
    apiScaling.scaleOnCpuUtilization('ApiCpuScaling', { targetUtilizationPercent: 70 });
    apiScaling.scaleOnMemoryUtilization('ApiMemoryScaling', { targetUtilizationPercent: 80 });

    // ── Worker task definition and service ───────────────────────
    const workerTaskDef = new ecs.FargateTaskDefinition(this, 'WorkerTaskDef', {
      family: `nestself-${stage}-worker`, cpu: 256, memoryLimitMiB: 512,
      executionRole: roles.executionRole, taskRole: roles.workerTaskRole,
    });

    workerTaskDef.addContainer('worker', {
      containerName: 'worker',
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      command: ['node', 'dist/worker/main.js'],
      environment: sharedEnv, secrets: sharedSecrets,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: new logs.LogGroup(this, 'WorkerLogGroup', {
          logGroupName: `/ecs/nestself-${stage}-worker`,
          retention: logRetention, removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        streamPrefix: 'worker',
      }),
    });

    const _workerService = new ecs.FargateService(this, 'WorkerService', {
      serviceName: `nestself-${stage}-worker`, cluster: this.cluster,
      taskDefinition: workerTaskDef, desiredCount: 1,
      securityGroups: [workerSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: !isProd,
    });

    // ── Marketing task definition and service ────────────────────
    const marketingTaskDef = new ecs.FargateTaskDefinition(this, 'MarketingTaskDef', {
      family: `nestself-${stage}-marketing`, cpu: 256, memoryLimitMiB: 512,
      executionRole: roles.executionRole, taskRole: roles.marketingTaskRole,
    });

    marketingTaskDef.addContainer('marketing', {
      containerName: 'marketing',
      image: ecs.ContainerImage.fromEcrRepository(this.marketingRepo, 'latest'),
      portMappings: [{ containerPort: 3000 }],
      environment: { NODE_ENV: isProd ? 'production' : 'development', HOSTNAME: '0.0.0.0', PORT: '3000' },
      logging: ecs.LogDrivers.awsLogs({
        logGroup: new logs.LogGroup(this, 'MarketingLogGroup', {
          logGroupName: `/ecs/nestself-${stage}-marketing`,
          retention: logRetention, removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        streamPrefix: 'marketing',
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(30), timeout: cdk.Duration.seconds(5),
        retries: 3, startPeriod: cdk.Duration.seconds(60),
      },
    });

    const mktService = new ecs.FargateService(this, 'MarketingService', {
      serviceName: `nestself-${stage}-marketing`, cluster: this.cluster,
      taskDefinition: marketingTaskDef, desiredCount: isProd ? 1 : 0,
      securityGroups: [marketingSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { enable: true, rollback: true },
    });

    this.albListener.addTargets('MarketingTargets', {
      port: 3000, protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [mktService],
      healthCheck: { path: '/health', interval: cdk.Duration.seconds(30), healthyThresholdCount: 2, unhealthyThresholdCount: 3 },
      conditions: [elbv2.ListenerCondition.hostHeaders([`${config.domainName}`])],
      priority: 20,
    });

    const mktScaling = mktService.autoScaleTaskCount({ minCapacity: isProd ? 1 : 0, maxCapacity: 4 });
    mktScaling.scaleOnCpuUtilization('MarketingCpuScaling', { targetUtilizationPercent: 70 });

    // ── Migrate task definition ──────────────────────────────────
    const migrateTaskDef = new ecs.FargateTaskDefinition(this, 'MigrateTaskDef', {
      family: `nestself-${stage}-migrate`, cpu: 256, memoryLimitMiB: 512,
      executionRole: roles.executionRole, taskRole: roles.apiTaskRole,
    });

    migrateTaskDef.addContainer('migrate', {
      containerName: 'migrate',
      image: ecs.ContainerImage.fromEcrRepository(this.apiRepo, 'latest'),
      command: ['pnpm', '--filter', '@nestself/api', 'db:migrate'],
      environment: sharedEnv,
      secrets: { DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret) },
      logging: ecs.LogDrivers.awsLogs({
        logGroup: new logs.LogGroup(this, 'MigrateLogGroup', {
          logGroupName: `/ecs/nestself-${stage}-migrate`,
          retention: logRetention, removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        streamPrefix: 'migrate',
      }),
      essential: true,
    });

    // ── Outputs ──────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName, exportName: `nestself-${stage}-cluster-name` });
    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName, exportName: `nestself-${stage}-alb-dns` });
    new cdk.CfnOutput(this, 'AlbArn', { value: this.alb.loadBalancerArn, exportName: `nestself-${stage}-alb-arn` });
    new cdk.CfnOutput(this, 'ApiRepoUri', { value: this.apiRepo.repositoryUri, exportName: `nestself-${stage}-ecr-api-uri` });
    new cdk.CfnOutput(this, 'MarketingRepoUri', { value: this.marketingRepo.repositoryUri, exportName: `nestself-${stage}-ecr-marketing-uri` });

    // ── cdk-nag acknowledgments ──────────────────────────────────
    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy]', reason: 'D-24: ECS execution role uses the AWS-managed execution role policy for ECR pulls and log writes.' },
      { id: 'AwsSolutions::AwsSolutions-IAM5', reason: 'D-30: Wildcard resources are scoped to the stage namespace or constrained by condition keys.' },
      { id: 'AwsSolutions::AwsSolutions-IAM5[Resource::*]', reason: 'D-30: PutMetricData requires * resource; scoped by namespace condition key.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:secretsmanager:${this.region}:${this.account}:secret:nestself-${stage}/*]`, reason: 'D-30: Execution role reads secrets scoped to the stage prefix.' },
      { id: `AwsSolutions::AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:ses:${this.region}:${this.account}:identity/*]`, reason: 'D-29: SES send scoped to account identities; individual identity ARN unknown at synth time.' },
      { id: 'AwsSolutions::AwsSolutions-EC23', reason: 'D-24: ALB security group allows inbound 80/443 from the internet by design; WAF on CloudFront provides L7 filtering.' },
      { id: 'AwsSolutions::AwsSolutions-ELB2', reason: 'D-31: ALB access logs are a phase 2 item; CloudFront access logs cover public traffic.' },
      { id: 'AwsSolutions::AwsSolutions-EC26', reason: 'D-24: EBS encryption is not applicable to Fargate tasks.' },
      { id: 'AwsSolutions::AwsSolutions-ECS2', reason: 'D-24: Environment variables contain non-sensitive configuration; secrets use Secrets Manager references.' },
      { id: 'AwsSolutions::AwsSolutions-SNS2', reason: 'D-31: SNS encryption is a phase 2 item.' },
      { id: 'AwsSolutions::AwsSolutions-SNS3', reason: 'D-31: SNS subscription filtering is not needed for the ops alarm topic.' },
    );
  }
}

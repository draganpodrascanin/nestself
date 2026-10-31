import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NestSelfComputeStack } from '../lib/compute-stack.js';
import { NestSelfNetworkStack } from '../lib/network-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import type { StageConfig } from '../lib/config.js';
import { getStageConfig } from '../lib/config.js';
import {
  AUTH_CONTEXT,
  CLOUDFRONT_PREFIX_LIST_ID,
  OPS_ALERT_EMAIL,
  PLATFORM_CONTEXT,
  testApp,
} from './context.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

interface ComputeOptions {
  /** Config of the compute stack under test; the other stacks keep the stage's own. */
  readonly computeConfig?: StageConfig;
  /** CDK context the deployer passes; defaults to everything a platform stage reads. */
  readonly context?: Record<string, unknown>;
}

function synthComputeStack(
  stage: 'staging' | 'production',
  { computeConfig, context = PLATFORM_CONTEXT }: ComputeOptions = {},
): Template {
  const app = testApp(context);
  const config = getStageConfig(stage);

  // Auth stack for cross-stack exports
  const _auth = new NestSelfAuthStack(app, `Test-${stage}-Auth`, {
    config,
    env: sharedEnv,
    ...synthesizerProps,
  });

  const security = new NestSelfSecurityBaselineStack(
    app, `Test-${stage}-Security`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const network = new NestSelfNetworkStack(
    app, `Test-${stage}-Network`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const stack = new NestSelfComputeStack(app, `Test-${stage}-Compute`, {
    config: computeConfig ?? config,
    vpc: network.vpc,
    platformKey: security.platformKey,
    env: sharedEnv,
    ...synthesizerProps,
  });

  return Template.fromStack(stack);
}

/** Asserts every variable is set on the container, whatever their order in the task definition. */
function expectEnvironment(
  template: Template,
  family: string,
  container: string,
  expected: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(expected)) {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: family,
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: container,
          Environment: Match.arrayWith([{ Name: name, Value: value }]),
        }),
      ]),
    });
  }
}

/** Asserts the container has none of the variables. */
function expectNoEnvironment(
  template: Template,
  family: string,
  container: string,
  names: readonly string[],
): void {
  for (const name of names) {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: family,
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: container,
          Environment: Match.not(Match.arrayWith([Match.objectLike({ Name: name })])),
        }),
      ]),
    });
  }
}

describe('NestSelfComputeStack -- staging', () => {
  const template = synthComputeStack('staging');

  it('creates an ECS cluster', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
  });

  it('creates two ECR repositories (api, marketing)', () => {
    template.resourceCountIs('AWS::ECR::Repository', 2);
  });

  // The worker validates the same env schema (AUTH_MODE=cognito requires all three).
  it.each([
    ['nestself-staging-api', 'api'],
    ['nestself-staging-worker', 'worker'],
  ])('passes the surface and API origins cognito mode requires to %s', (family, container) => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: family,
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: container,
          Environment: Match.arrayWith([
            { Name: 'AUTH_MODE', Value: 'cognito' },
            { Name: 'WORKSPACE_URL', Value: 'https://app.staging.nestself.rs' },
            { Name: 'ADMIN_URL', Value: 'https://admin.staging.nestself.rs' },
            { Name: 'API_PUBLIC_URL', Value: 'https://app.staging.nestself.rs' },
          ]),
        }),
      ]),
    });
  });

  // NODE_ENV=production keeps devToken out of responses; the mail and proxy settings come from the stage.
  it.each([
    ['nestself-staging-api', 'api'],
    ['nestself-staging-worker', 'worker'],
  ])('runs %s as production with the sender, the ops mailbox and two proxy hops', (family, container) => {
    expectEnvironment(template, family, container, {
      NODE_ENV: 'production',
      SES_FROM_EMAIL: 'no-reply@staging.nestself.rs',
      OPS_ALERT_EMAIL,
      TRUST_PROXY_HOPS: '2',
    });
  });

  it('lets the API task role list users and read one with AdminGetUser (MFA enrolment lookup)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['cognito-idp:AdminGetUser', 'cognito-idp:ListUsers']),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('lets the API task role manage SSO identity providers and the app clients that list them', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'cognito-idp:DescribeUserPoolClient',
              'cognito-idp:UpdateUserPoolClient',
              'cognito-idp:CreateIdentityProvider',
              'cognito-idp:UpdateIdentityProvider',
              'cognito-idp:DeleteIdentityProvider',
              'cognito-idp:DescribeIdentityProvider',
              'cognito-idp:ListIdentityProviders',
            ]),
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  it('creates an ALB', () => {
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  });

  it('creates API task definition with 512 CPU and 1024 MB', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'nestself-staging-api',
      Cpu: '512',
      Memory: '1024',
    });
  });

  it('creates worker task definition with 256 CPU and 512 MB', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'nestself-staging-worker',
      Cpu: '256',
      Memory: '512',
    });
  });

  it('creates migrate task definition with 256 CPU and 512 MB', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'nestself-staging-migrate',
      Cpu: '256',
      Memory: '512',
    });
  });

  it('creates marketing task definition', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'nestself-staging-marketing',
    });
  });

  it('sets API service desired count from config.apiMinTasks', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'nestself-staging-api',
      DesiredCount: 1,
    });
  });

  it('enables deployment circuit breaker on API service', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'nestself-staging-api',
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it('creates four log groups for services and migrate', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/nestself-staging-api',
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/nestself-staging-worker',
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/nestself-staging-marketing',
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/ecs/nestself-staging-migrate',
    });
  });

  it('creates autoscaling targets for API', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      ServiceNamespace: 'ecs',
    });
  });

  it('exports the ALB DNS name', () => {
    template.hasOutput('AlbDnsName', {});
  });

  it('exports ECR repository URIs', () => {
    template.hasOutput('ApiRepoUri', {});
    template.hasOutput('MarketingRepoUri', {});
  });
});

describe('NestSelfComputeStack -- production', () => {
  const template = synthComputeStack('production');

  it('sets API service desired count to 2 in production', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      ServiceName: 'nestself-production-api',
      DesiredCount: 2,
    });
  });

  it('ECR repositories have scan on push enabled', () => {
    template.hasResourceProperties('AWS::ECR::Repository', {
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it.each([
    ['nestself-production-api', 'api'],
    ['nestself-production-worker', 'worker'],
  ])('runs %s as production with the sender, the ops mailbox and two proxy hops', (family, container) => {
    expectEnvironment(template, family, container, {
      NODE_ENV: 'production',
      SES_FROM_EMAIL: 'no-reply@nestself.rs',
      OPS_ALERT_EMAIL,
      TRUST_PROXY_HOPS: '2',
    });
  });
});

describe('NestSelfComputeStack -- ALB reachable from CloudFront only', () => {
  const albGroup = { 'Fn::GetAtt': [Match.stringLikeRegexp('^AlbSg'), 'GroupId'] };

  it.each(['staging', 'production'] as const)('%s admits HTTP from the CloudFront prefix list and nothing else', (stage) => {
    const template = synthComputeStack(stage);
    // The one rule added to the group after it was created...
    const rules = template.findResources('AWS::EC2::SecurityGroupIngress', { Properties: { GroupId: albGroup } });
    expect(Object.values(rules).map((rule) => rule.Properties)).toEqual([
      expect.objectContaining({
        SourcePrefixListId: CLOUDFRONT_PREFIX_LIST_ID,
        IpProtocol: 'tcp',
        FromPort: 80,
        ToPort: 80,
      }),
    ]);
    // ...and no inline rule on the group itself (the listener's default would add 0.0.0.0/0 there).
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: `nestself-${stage} ALB security group`,
      SecurityGroupIngress: Match.absent(),
    });
  });

  it('opens 80 and 443 to the internet only when no proxy is in front (trustProxyHops 0), as in dev', () => {
    const template = synthComputeStack('staging', {
      computeConfig: { ...getStageConfig('staging'), trustProxyHops: 0 },
      context: AUTH_CONTEXT,
    });
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupDescription: 'nestself-staging ALB security group',
      SecurityGroupIngress: [
        { CidrIp: '0.0.0.0/0', IpProtocol: 'tcp', FromPort: 80, ToPort: 80 },
        { CidrIp: '0.0.0.0/0', IpProtocol: 'tcp', FromPort: 443, ToPort: 443 },
      ],
    });
    expect(
      template.findResources('AWS::EC2::SecurityGroupIngress', {
        Properties: { SourcePrefixListId: Match.anyValue() },
      }),
    ).toEqual({});
    expectEnvironment(template, 'nestself-staging-api', 'api', { TRUST_PROXY_HOPS: '0' });
  });

  it.each([
    { given: 'no value', context: AUTH_CONTEXT },
    { given: 'an empty value', context: { ...AUTH_CONTEXT, cloudfrontOriginPrefixListId: '' } },
  ])('does not synthesize with proxy hops and $given for cloudfrontOriginPrefixListId', ({ context }) => {
    expect(() => synthComputeStack('production', { context })).toThrow(
      'ALB ingress from CloudFront needs context cloudfrontOriginPrefixListId; see CDK-setup.md',
    );
  });
});

describe('NestSelfComputeStack -- optional mail settings', () => {
  it('leaves OPS_ALERT_EMAIL unset without the opsAlertEmail context', () => {
    const template = synthComputeStack('production', {
      context: { ...AUTH_CONTEXT, cloudfrontOriginPrefixListId: CLOUDFRONT_PREFIX_LIST_ID },
    });
    expectNoEnvironment(template, 'nestself-production-api', 'api', ['OPS_ALERT_EMAIL']);
    expectEnvironment(template, 'nestself-production-api', 'api', { SES_FROM_EMAIL: 'no-reply@nestself.rs' });
  });

  it('leaves SES_FROM_EMAIL unset for a stage without a sender', () => {
    const template = synthComputeStack('staging', {
      computeConfig: { ...getStageConfig('staging'), sesFromEmail: undefined },
    });
    expectNoEnvironment(template, 'nestself-staging-api', 'api', ['SES_FROM_EMAIL']);
    expectEnvironment(template, 'nestself-staging-api', 'api', { OPS_ALERT_EMAIL });
  });
});

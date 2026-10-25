import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NestSelfComputeStack } from '../lib/compute-stack.js';
import { NestSelfNetworkStack } from '../lib/network-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import { getStageConfig } from '../lib/config.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

function synthComputeStack(stage: 'staging' | 'production'): Template {
  const app = new cdk.App();
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
    config,
    vpc: network.vpc,
    platformKey: security.platformKey,
    env: sharedEnv,
    ...synthesizerProps,
  });

  return Template.fromStack(stack);
}

describe('NestSelfComputeStack -- staging', () => {
  const template = synthComputeStack('staging');

  it('creates an ECS cluster', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
  });

  it('creates two ECR repositories (api, marketing)', () => {
    template.resourceCountIs('AWS::ECR::Repository', 2);
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
});

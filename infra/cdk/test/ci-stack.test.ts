import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NestSelfCiStack } from '../lib/ci-stack.js';
import { getStageConfig } from '../lib/config.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

function synthCiStack(stage: 'staging' | 'production'): Template {
  const app = new cdk.App();
  const config = getStageConfig(stage);

  const stack = new NestSelfCiStack(app, `Test-${stage}-CI`, {
    config, env: sharedEnv, ...synthesizerProps,
  });

  return Template.fromStack(stack);
}

describe('NestSelfCiStack -- staging', () => {
  const template = synthCiStack('staging');

  it('creates a GitHub OIDC provider', () => {
    template.resourceCountIs('Custom::AWSCDKOpenIdConnectProvider', 1);
  });

  it('creates a deploy role', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nestself-staging-github-deploy',
    });
  });

  it('deploy role has ECR push policy', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ecr:PutImage']),
          }),
        ]),
      }),
    });
  });

  it('exports the deploy role ARN', () => {
    template.hasOutput('DeployRoleArn', {});
  });
});

describe('NestSelfCiStack -- production', () => {
  const template = synthCiStack('production');

  it('creates a deploy role for production', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nestself-production-github-deploy',
    });
  });

  it('creates an OIDC provider', () => {
    const providers = template.findResources('Custom::AWSCDKOpenIdConnectProvider');
    expect(Object.keys(providers).length).toBe(1);
  });
});

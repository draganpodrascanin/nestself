import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NestSelfEdgeStack } from '../lib/edge-stack.js';
import { NestSelfComputeStack } from '../lib/compute-stack.js';
import { NestSelfNetworkStack } from '../lib/network-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import { getStageConfig } from '../lib/config.js';
import { PLATFORM_CONTEXT, testApp } from './context.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

function synthEdgeStack(stage: 'staging' | 'production'): Template {
  const app = testApp(PLATFORM_CONTEXT);
  const config = getStageConfig(stage);

  const _auth = new NestSelfAuthStack(app, `Test-${stage}-Auth`, {
    config, env: sharedEnv, ...synthesizerProps,
  });

  const security = new NestSelfSecurityBaselineStack(
    app, `Test-${stage}-Security`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const network = new NestSelfNetworkStack(
    app, `Test-${stage}-Network`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const compute = new NestSelfComputeStack(app, `Test-${stage}-Compute`, {
    config, vpc: network.vpc, platformKey: security.platformKey,
    env: sharedEnv, ...synthesizerProps,
  });

  const stack = new NestSelfEdgeStack(app, `Test-${stage}-Edge`, {
    config,
    alb: compute.alb,
    platformKey: security.platformKey,
    env: sharedEnv,
    ...synthesizerProps,
  });

  return Template.fromStack(stack);
}

describe('NestSelfEdgeStack -- staging', () => {
  const template = synthEdgeStack('staging');

  it('creates two S3 buckets for workspace and admin SPAs', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  it('creates two CloudFront distributions', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 2);
  });

  it('creates a response headers policy', () => {
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
  });

  it('S3 buckets block public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('exports bucket names and distribution IDs', () => {
    template.hasOutput('WorkspaceBucketName', {});
    template.hasOutput('AdminBucketName', {});
    template.hasOutput('WorkspaceDistributionId', {});
    template.hasOutput('AdminDistributionId', {});
  });
});

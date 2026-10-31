import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import { NestSelfNetworkStack } from '../lib/network-stack.js';
import { NestSelfDataStack } from '../lib/data-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { NestSelfComputeStack } from '../lib/compute-stack.js';
import { NestSelfEdgeStack } from '../lib/edge-stack.js';
import { NestSelfObservabilityStack } from '../lib/observability-stack.js';
import { NestSelfCiStack } from '../lib/ci-stack.js';
import { NestSelfVideoStack } from '../lib/video-stack.js';
import { getStageConfig } from '../lib/config.js';
import { AUTH_CONTEXT, PLATFORM_CONTEXT, testApp } from './context.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

describe('cdk-nag AwsSolutions -- auth stack', () => {
  it('dev auth stack synthesizes with nag plugin without violations', () => {
    const app = testApp();
    const config = getStageConfig('dev');
    const _stack = new NestSelfAuthStack(app, 'NagDevAuth', {
      config,
      env: sharedEnv,
      ...synthesizerProps,
    });
    Validations.of(app).addPlugins(new AwsSolutionsChecks());
    // Synthesis runs the validation plugin; if violations remain it throws
    const assembly = app.synth();
    expect(assembly).toBeDefined();
  });

  it('production auth stack synthesizes with nag plugin without violations', () => {
    const app = testApp(AUTH_CONTEXT);
    const config = getStageConfig('production');
    const _stack = new NestSelfAuthStack(app, 'NagProdAuth', {
      config,
      env: sharedEnv,
      ...synthesizerProps,
    });
    Validations.of(app).addPlugins(new AwsSolutionsChecks());
    const assembly = app.synth();
    expect(assembly).toBeDefined();
  });
});

describe('cdk-nag AwsSolutions -- video stack', () => {
  it('dev video stack (own key) synthesizes with nag plugin without violations', () => {
    const app = new cdk.App();
    const config = getStageConfig('dev');
    const _stack = new NestSelfVideoStack(app, 'NagDevVideo', {
      config,
      env: sharedEnv,
      ...synthesizerProps,
    });
    Validations.of(app).addPlugins(new AwsSolutionsChecks());
    const assembly = app.synth();
    expect(assembly).toBeDefined();
  });
});

describe('cdk-nag AwsSolutions -- staging full synth', () => {
  it('all staging stacks synthesize with nag plugin', () => {
    const app = testApp(PLATFORM_CONTEXT);
    const config = getStageConfig('staging');

    const securityBaseline = new NestSelfSecurityBaselineStack(
      app, 'NagStagingSecurity', { config, env: sharedEnv, ...synthesizerProps },
    );

    const network = new NestSelfNetworkStack(
      app, 'NagStagingNetwork', { config, env: sharedEnv, ...synthesizerProps },
    );

    const _data = new NestSelfDataStack(app, 'NagStagingData', {
      config,
      env: sharedEnv,
      platformKey: securityBaseline.platformKey,
      vpc: network.vpc,
      ...synthesizerProps,
    });

    const _auth = new NestSelfAuthStack(
      app, 'NagStagingAuth', { config, env: sharedEnv, ...synthesizerProps },
    );

    const compute = new NestSelfComputeStack(app, 'NagStagingCompute', {
      config,
      env: sharedEnv,
      vpc: network.vpc,
      platformKey: securityBaseline.platformKey,
      ...synthesizerProps,
    });

    const _edge = new NestSelfEdgeStack(app, 'NagStagingEdge', {
      config,
      env: sharedEnv,
      alb: compute.alb,
      platformKey: securityBaseline.platformKey,
      ...synthesizerProps,
    });

    const _observability = new NestSelfObservabilityStack(
      app, 'NagStagingObservability',
      { config, env: sharedEnv, ...synthesizerProps },
    );

    const _ci = new NestSelfCiStack(
      app, 'NagStagingCI',
      { config, env: sharedEnv, ...synthesizerProps },
    );

    const _video = new NestSelfVideoStack(app, 'NagStagingVideo', {
      config,
      env: sharedEnv,
      platformKey: securityBaseline.platformKey,
      ...synthesizerProps,
    });

    Validations.of(app).addPlugins(new AwsSolutionsChecks());
    const assembly = app.synth();
    expect(assembly).toBeDefined();
  });
});

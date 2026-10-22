#!/usr/bin/env tsx
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
import type { Stage } from '../lib/config.js';
import { getStageConfig } from '../lib/config.js';

const app = new cdk.App();

const stage = (app.node.tryGetContext('stage') as Stage | undefined) ?? 'dev';
const config = getStageConfig(stage);

const region = 'eu-central-1';

/** Resolve the AWS account id from context, env vars, or per-stage env vars. */
function resolveAccount(): string {
  const fromContext = app.node.tryGetContext('account') as string | undefined;
  if (fromContext) return fromContext;

  const envMap: Record<Stage, string | undefined> = {
    dev: process.env['AWS_ACCOUNT_DEV'],
    staging: process.env['AWS_ACCOUNT_STAGING'],
    production: process.env['AWS_ACCOUNT_PRODUCTION'],
  };
  const fromEnv = envMap[stage];
  if (fromEnv) return fromEnv;

  const defaultAccount = process.env['CDK_DEFAULT_ACCOUNT'];
  if (defaultAccount) return defaultAccount;

  // Fallback for offline synth; the deployer must pass -c account=<id>
  return '000000000000';
}

const account = resolveAccount();
const env: cdk.Environment = { account, region };

/**
 * Shared stack props.
 * generateBootstrapVersionRule: false so synth works offline without a bootstrap stack.
 * AZ context for the target account is pre-set in cdk.json so no lookup is needed.
 * Pass --no-lookups when synthesizing offline to avoid credential checks.
 */
const sharedProps: cdk.StackProps = {
  env,
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

// --- Auth stack (every stage) ---
// Rollout order (2026-10-22): Cognito only while development is local, then the
// platform stacks when the web apps ship, mobile last. Without `-c platform=true`
// this app contains only the auth stack, so `cdk deploy --all` cannot create the
// network, database, compute, edge, observability or CI resources by accident.
const _authStack = new NestSelfAuthStack(app, `NestSelf-${stage}-Auth`, {
  ...sharedProps,
  config,
});

const platformRequested =
  app.node.tryGetContext('platform') === 'true' || app.node.tryGetContext('platform') === true;
if (platformRequested && stage === 'dev') {
  throw new Error('The platform stacks are not defined for the dev stage; use -c stage=staging or production.');
}

// --- Platform stacks (staging and production, opt-in with -c platform=true) ---
if (platformRequested) {
  const securityBaseline = new NestSelfSecurityBaselineStack(
    app,
    `NestSelf-${stage}-SecurityBaseline`,
    { ...sharedProps, config },
  );

  const network = new NestSelfNetworkStack(
    app,
    `NestSelf-${stage}-Network`,
    { ...sharedProps, config },
  );

  const _data = new NestSelfDataStack(app, `NestSelf-${stage}-Data`, {
    ...sharedProps,
    config,
    platformKey: securityBaseline.platformKey,
    vpc: network.vpc,
  });

  const compute = new NestSelfComputeStack(app, `NestSelf-${stage}-Compute`, {
    ...sharedProps,
    config,
    vpc: network.vpc,
    platformKey: securityBaseline.platformKey,
  });

  const _edge = new NestSelfEdgeStack(app, `NestSelf-${stage}-Edge`, {
    ...sharedProps,
    config,
    alb: compute.alb,
    platformKey: securityBaseline.platformKey,
  });

  const _observability = new NestSelfObservabilityStack(
    app,
    `NestSelf-${stage}-Observability`,
    { ...sharedProps, config },
  );

  const _ci = new NestSelfCiStack(app, `NestSelf-${stage}-CI`, {
    ...sharedProps,
    config,
  });
}

// --- cdk-nag ---
const enableNag = app.node.tryGetContext('nag') !== 'false'
  && app.node.tryGetContext('nag') !== false;
if (enableNag) {
  Validations.of(app).addPlugins(new AwsSolutionsChecks());
}

app.synth();

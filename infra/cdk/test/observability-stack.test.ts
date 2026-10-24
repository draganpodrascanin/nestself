import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NestSelfObservabilityStack } from '../lib/observability-stack.js';
import { getStageConfig } from '../lib/config.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

function synthObservabilityStack(stage: 'staging' | 'production'): Template {
  const app = new cdk.App();
  const config = getStageConfig(stage);

  const stack = new NestSelfObservabilityStack(
    app, `Test-${stage}-Observability`,
    { config, env: sharedEnv, ...synthesizerProps },
  );

  return Template.fromStack(stack);
}

describe('NestSelfObservabilityStack -- staging', () => {
  const template = synthObservabilityStack('staging');

  it('creates an SNS alarm topic', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'nestself-staging-alarms',
    });
  });

  it('creates metric filters for failed sign-ins', () => {
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      MetricTransformations: Match.arrayWith([
        Match.objectLike({ MetricName: 'FailedSignIns' }),
      ]),
    });
  });

  it('creates metric filters for emergency access', () => {
    // The API logs `{ action: 'emergency_access.approved' }` once per approval.
    template.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ $.action = "emergency_access.approved" }',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({ MetricName: 'EmergencyAccessActivations' }),
      ]),
    });
  });

  it('creates CloudWatch alarms', () => {
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThanOrEqual(4);
  });

  it('emergency access alarm has threshold of 0', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'nestself-staging-emergency-access',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });
});

describe('NestSelfObservabilityStack -- production', () => {
  const template = synthObservabilityStack('production');

  it('API task count alarm threshold is 2 in production', () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'nestself-production-api-task-count',
      Threshold: 2,
    });
  });
});

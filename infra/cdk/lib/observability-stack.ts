import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

/**
 * NestSelfObservabilityStack: CloudWatch log groups, metric filters,
 * alarms and SNS topic for operational alerts.
 * [D-31, OPS-R-03, OPS-R-04]
 */
export class NestSelfObservabilityStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;
    const isProd = stage === 'production';
    const ns = `nestself/${stage}`;

    // ── SNS alarm topic ──────────────────────────────────────────
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `nestself-${stage}-alarms`,
      displayName: `NestSelf ${stage} alarms`,
    });

    const alarmAction = new cw_actions.SnsAction(this.alarmTopic);

    // ── Metric: failed sign-ins per IP (via metric filter) ───────
    // The API log group is created by the compute stack. Reference it here.
    const apiLogGroup = logs.LogGroup.fromLogGroupName(
      this, 'ApiLogGroup', `/ecs/nestself-${stage}-api`,
    );

    new logs.MetricFilter(this, 'FailedSignInFilter', {
      logGroup: apiLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.action = "auth.sign_in.failed" }',
      ),
      metricNamespace: ns,
      metricName: 'FailedSignIns',
      metricValue: '1',
      defaultValue: 0,
    });

    const failedSignInsAlarm = new cloudwatch.Alarm(this, 'FailedSignInsAlarm', {
      alarmName: `nestself-${stage}-failed-sign-ins`,
      alarmDescription: 'Failed sign-in attempts exceed 50/min [D-31, OPS-R-04]',
      metric: new cloudwatch.Metric({
        namespace: ns,
        metricName: 'FailedSignIns',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    failedSignInsAlarm.addAlarmAction(alarmAction);

    // ── Metric: principal cache hit rate ─────────────────────────
    new logs.MetricFilter(this, 'CacheHitFilter', {
      logGroup: apiLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.action = "principal.cache.hit" }',
      ),
      metricNamespace: ns,
      metricName: 'PrincipalCacheHits',
      metricValue: '1',
      defaultValue: 0,
    });

    new logs.MetricFilter(this, 'CacheMissFilter', {
      logGroup: apiLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.action = "principal.cache.miss" }',
      ),
      metricNamespace: ns,
      metricName: 'PrincipalCacheMisses',
      metricValue: '1',
      defaultValue: 0,
    });

    const cacheHitRateAlarm = new cloudwatch.Alarm(this, 'CacheHitRateAlarm', {
      alarmName: `nestself-${stage}-cache-hit-rate`,
      alarmDescription: 'Principal cache hit rate below 90% [D-31]',
      metric: new cloudwatch.MathExpression({
        expression: '100 * hits / (hits + misses)',
        usingMetrics: {
          hits: new cloudwatch.Metric({
            namespace: ns,
            metricName: 'PrincipalCacheHits',
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
          }),
          misses: new cloudwatch.Metric({
            namespace: ns,
            metricName: 'PrincipalCacheMisses',
            statistic: 'Sum',
            period: cdk.Duration.minutes(15),
          }),
        },
        period: cdk.Duration.minutes(15),
      }),
      threshold: 90,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    cacheHitRateAlarm.addAlarmAction(alarmAction);

    // ── Metric: emergency access activation ──────────────────────
    new logs.MetricFilter(this, 'EmergencyAccessFilter', {
      logGroup: apiLogGroup,
      filterPattern: logs.FilterPattern.literal(
        '{ $.action = "emergency_access.activated" }',
      ),
      metricNamespace: ns,
      metricName: 'EmergencyAccessActivations',
      metricValue: '1',
      defaultValue: 0,
    });

    const emergencyAlarm = new cloudwatch.Alarm(this, 'EmergencyAccessAlarm', {
      alarmName: `nestself-${stage}-emergency-access`,
      alarmDescription: 'Emergency access activated [D-20, OPS-R-04]',
      metric: new cloudwatch.Metric({
        namespace: ns,
        metricName: 'EmergencyAccessActivations',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    emergencyAlarm.addAlarmAction(alarmAction);

    // ── ALB 5xx rate alarm ───────────────────────────────────────
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      alarmName: `nestself-${stage}-alb-5xx`,
      alarmDescription: 'ALB target 5xx rate exceeds 1% [D-31]',
      metric: new cloudwatch.MathExpression({
        expression: '100 * errors / requests',
        usingMetrics: {
          errors: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: {
              LoadBalancer: cdk.Fn.importValue(`nestself-${stage}-alb-arn`),
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          requests: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: {
              LoadBalancer: cdk.Fn.importValue(`nestself-${stage}-alb-arn`),
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xxAlarm.addAlarmAction(alarmAction);

    // ── RDS CPU alarm ────────────────────────────────────────────
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: `nestself-${stage}-rds-cpu`,
      alarmDescription: 'RDS CPU utilization above 80% [D-31]',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: { DBInstanceIdentifier: `nestself-${stage}` },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsCpuAlarm.addAlarmAction(alarmAction);

    // ── ECS task count alarm ─────────────────────────────────────
    const taskCountAlarm = new cloudwatch.Alarm(this, 'ApiTaskCountAlarm', {
      alarmName: `nestself-${stage}-api-task-count`,
      alarmDescription: 'API running task count below minimum [D-31]',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ClusterName: `nestself-${stage}`,
          ServiceName: `nestself-${stage}-api`,
        },
        statistic: 'Minimum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: isProd ? 2 : 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    taskCountAlarm.addAlarmAction(alarmAction);

    // Suppress unused variable lint for alarms wired only to actions
    void alb5xxAlarm;
    void rdsCpuAlarm;
    void taskCountAlarm;
    void cacheHitRateAlarm;

    // ── cdk-nag acknowledgments ──────────────────────────────────
    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-SNS2', reason: 'D-31: SNS topic encryption with KMS is a phase 2 item; topic carries alarm metadata only.' },
      { id: 'AwsSolutions::AwsSolutions-SNS3', reason: 'D-31: SNS subscription filtering is not needed for a single-purpose alarm topic.' },
    );
  }
}

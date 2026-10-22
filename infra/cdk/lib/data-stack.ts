import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface DataStackProps extends cdk.StackProps {
  readonly config: StageConfig;
  readonly platformKey: kms.IKey;
  readonly vpc: ec2.IVpc;
}

export class NestSelfDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config, platformKey, vpc } = props;
    const stage = config.stage;
    const isProd = stage === 'production';

    // ── RDS PostgreSQL 17 ─────────────────────────────────────────
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: `nestself-${stage} RDS security group`,
      allowAllOutbound: true,
    });

    const _dbInstance = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      databaseName: 'nestself',
      multiAz: isProd,
      storageEncrypted: true,
      storageEncryptionKey: platformKey,
      backupRetention: cdk.Duration.days(35),
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoMinorVersionUpgrade: true,
    });

    // ── ElastiCache for Valkey ────────────────────────────────────
    const cacheSecurityGroup = new ec2.SecurityGroup(this, 'CacheSg', {
      vpc,
      description: `nestself-${stage} ElastiCache security group`,
      allowAllOutbound: true,
    });

    const _valkeyAuthToken = new secretsmanager.Secret(this, 'ValkeyAuthToken', {
      secretName: `nestself-${stage}/valkey/auth-token`,
      description: 'ElastiCache Valkey AUTH token',
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });

    const subnetGroup = new elasticache.CfnSubnetGroup(this, 'CacheSubnetGroup', {
      description: `nestself-${stage} cache subnets`,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      cacheSubnetGroupName: `nestself-${stage}-cache`,
    });

    const parameterGroup = new elasticache.CfnParameterGroup(this, 'ValkeyParams', {
      cacheParameterGroupFamily: 'valkey8',
      description: `nestself-${stage} Valkey parameters`,
      properties: { 'maxmemory-policy': 'noeviction' },
    });

    new elasticache.CfnCacheCluster(this, 'ValkeyCluster', {
      clusterName: `nestself-${stage}-valkey`,
      engine: 'valkey',
      cacheNodeType: 'cache.t4g.micro',
      numCacheNodes: 1,
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
      cacheParameterGroupName: parameterGroup.ref,
      vpcSecurityGroupIds: [cacheSecurityGroup.securityGroupId],
      transitEncryptionEnabled: true,
    });

    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-RDS3', reason: 'D-23: Multi-AZ is production-only at pilot; staging uses single-AZ.' },
      { id: 'AwsSolutions::AwsSolutions-RDS11', reason: 'D-25: Default port acceptable; security groups enforce access control.' },
      { id: 'AwsSolutions::AwsSolutions-SMG4', reason: 'D-26: Valkey auth token rotation is a phase 2 item.' },
      { id: 'AwsSolutions::AwsSolutions-EC23', reason: 'D-23: Security groups allow all outbound; inbound is restricted.' },
      { id: 'AwsSolutions::AwsSolutions-AEC5', reason: 'D-26: ElastiCache default port acceptable; security groups enforce access.' },
    );
  }
}

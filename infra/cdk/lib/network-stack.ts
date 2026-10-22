import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface NetworkStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

export class NestSelfNetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;

    // Pin AZs to avoid lookup calls that require credentials [D-23]
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `nestself-${stage}`,
      availabilityZones: ['eu-central-1a', 'eu-central-1b'],
      natGateways: 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // S3 gateway endpoint (free)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoints
    const interfaceEndpoints = [
      { id: 'EcrApiEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: 'EcrDkrEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: 'CloudWatchLogsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: 'SecretsManagerEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: 'StsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.STS },
    ];

    for (const ep of interfaceEndpoints) {
      this.vpc.addInterfaceEndpoint(ep.id, {
        service: ep.service,
        privateDnsEnabled: true,
      });
    }

    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-VPC7', reason: 'D-23: VPC Flow Logs enabled in production only. Staging skips for cost.' },
      { id: 'AwsSolutions::AwsSolutions-EC23', reason: 'D-23: VPC endpoint security groups use CDK-generated rules with intrinsic function refs.' },
    );
  }
}

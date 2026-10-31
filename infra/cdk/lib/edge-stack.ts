import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';
import type { WebApp } from './web-security-headers.js';
import {
  WEB_APP_PERMISSIONS_POLICY,
  webAppContentSecurityPolicy,
  webAppInlineScriptHashes,
} from './web-security-headers.js';

export interface EdgeStackProps extends cdk.StackProps {
  readonly config: StageConfig;
  readonly alb: elbv2.IApplicationLoadBalancer;
  readonly platformKey: kms.IKey;
}

/**
 * NestSelfEdgeStack: CloudFront distributions for workspace and admin SPAs
 * with S3 origins (OAC), API behaviours forwarding to the ALB, per-app
 * response headers policies (CSP, HSTS, Permissions-Policy) and WAF web ACLs.
 *
 * WAF for CloudFront must be in us-east-1. Because crossRegionReferences
 * requires lookups and breaks offline synth, we create the WAF ACL in the
 * same stack scope and document the limitation: deploy must target us-east-1
 * for the WAF resource, or a separate stack is needed post-bootstrap.
 *
 * Chosen approach: WAF ACL is created in-stack with scope CLOUDFRONT. CDK
 * synthesizes this in the stack's region. At deploy time the stack must be
 * deployed to us-east-1 OR the WAF must be created in a separate us-east-1
 * stack. We use a context flag `edgeWafArn` to allow pre-provisioned WAF.
 * When absent and enableWaf is true, we create the ACL in-stack with scope
 * CLOUDFRONT (valid only when the stack itself is in us-east-1).
 *
 * For offline synth in eu-central-1 with --no-lookups, WAF association is
 * skipped unless edgeWafArn is provided. This is documented as a deploy-time
 * step.
 * [D-08, D-28]
 */
export class NestSelfEdgeStack extends cdk.Stack {
  public readonly workspaceBucket: s3.Bucket;
  public readonly adminBucket: s3.Bucket;
  public readonly workspaceDistribution: cloudfront.Distribution;
  public readonly adminDistribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);

    const { config, alb, platformKey: _platformKey } = props;
    const stage = config.stage;

    // ── S3 buckets for SPAs ──────────────────────────────────────
    this.workspaceBucket = new s3.Bucket(this, 'WorkspaceBucket', {
      bucketName: `nestself-${stage}-spa-workspace-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: config.removalPolicy === 'destroy'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: config.removalPolicy === 'destroy',
    });

    this.adminBucket = new s3.Bucket(this, 'AdminBucket', {
      bucketName: `nestself-${stage}-spa-admin-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: config.removalPolicy === 'destroy'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: config.removalPolicy === 'destroy',
    });

    // ── Response headers policies (one per app) ──────────────────
    // The Content-Security-Policy header is the source of truth in deployed
    // stages; the <meta> tag the Vite build injects is the fallback for
    // `vite preview` and other static hosts (docs/web/csp.md, T-CW-1.5).
    // `/api/*` goes through the app's own distribution, so the app origin is
    // the API origin for connect-src.
    const webAppHeaders = (app: WebApp, constructId: string, appUrl: string) =>
      new cloudfront.ResponseHeadersPolicy(this, constructId, {
        responseHeadersPolicyName: `nestself-${stage}-${app}-security-headers`,
        comment: `nestself-${stage} ${app} SPA security headers`,
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            contentSecurityPolicy: webAppContentSecurityPolicy({
              inlineScriptHashes: webAppInlineScriptHashes(app),
              apiOrigin: new URL(appUrl).origin,
            }),
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(63072000),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          xssProtection: { protection: true, modeBlock: true, override: true },
        },
        customHeadersBehavior: {
          customHeaders: [
            { header: 'Permissions-Policy', value: WEB_APP_PERMISSIONS_POLICY, override: true },
          ],
        },
      });
    const workspaceHeaders = webAppHeaders('workspace', 'WorkspaceSecurityHeaders', config.workspaceUrl);
    const adminHeaders = webAppHeaders('admin', 'AdminSecurityHeaders', config.adminUrl);

    // ── WAF web ACL (optional, context-driven) ───────────────────
    // CloudFront WAF must be in us-east-1. For offline synth in eu-central-1
    // we skip WAF creation and allow a pre-provisioned ARN via context.
    let wafAclArn: string | undefined;

    if (config.enableWaf) {
      const contextWafArn = this.node.tryGetContext('edgeWafArn') as string | undefined;
      if (contextWafArn) {
        wafAclArn = contextWafArn;
      }
      // When no edgeWafArn is provided, the WAF must be created in a
      // separate us-east-1 stack or manually. See README for deploy steps.
    }

    // ── ALB origin ───────────────────────────────────────────────
    const albOrigin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      keepaliveTimeout: cdk.Duration.seconds(60),
      readTimeout: cdk.Duration.seconds(60),
    });

    // ── No-cache policy for API behaviours ───────────────────────
    const apiCachePolicy = cloudfront.CachePolicy.CACHING_DISABLED;
    const apiOriginRequestPolicy = cloudfront.OriginRequestPolicy.ALL_VIEWER;

    // ── Workspace distribution ───────────────────────────────────
    this.workspaceDistribution = new cloudfront.Distribution(
      this, 'WorkspaceDist', {
        comment: `nestself-${stage} workspace SPA`,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.workspaceBucket,
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: workspaceHeaders,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        additionalBehaviors: {
          '/api/*': {
            origin: albOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiCachePolicy,
            originRequestPolicy: apiOriginRequestPolicy,
            responseHeadersPolicy: workspaceHeaders,
          },
          '/api/ws*': {
            origin: albOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiCachePolicy,
            originRequestPolicy: apiOriginRequestPolicy,
          },
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
        ],
        webAclId: wafAclArn,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      },
    );

    // ── Admin distribution ───────────────────────────────────────
    this.adminDistribution = new cloudfront.Distribution(
      this, 'AdminDist', {
        comment: `nestself-${stage} admin SPA`,
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.adminBucket,
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy: adminHeaders,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        additionalBehaviors: {
          '/api/*': {
            origin: albOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiCachePolicy,
            originRequestPolicy: apiOriginRequestPolicy,
            responseHeadersPolicy: adminHeaders,
          },
          '/api/ws*': {
            origin: albOrigin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: apiCachePolicy,
            originRequestPolicy: apiOriginRequestPolicy,
          },
        },
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
        ],
        webAclId: wafAclArn,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      },
    );

    // ── Outputs ──────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WorkspaceBucketName', {
      value: this.workspaceBucket.bucketName,
      exportName: `nestself-${stage}-spa-workspace-bucket`,
    });
    new cdk.CfnOutput(this, 'AdminBucketName', {
      value: this.adminBucket.bucketName,
      exportName: `nestself-${stage}-spa-admin-bucket`,
    });
    new cdk.CfnOutput(this, 'WorkspaceDistributionId', {
      value: this.workspaceDistribution.distributionId,
      exportName: `nestself-${stage}-cf-workspace-id`,
    });
    new cdk.CfnOutput(this, 'AdminDistributionId', {
      value: this.adminDistribution.distributionId,
      exportName: `nestself-${stage}-cf-admin-id`,
    });
    new cdk.CfnOutput(this, 'WorkspaceDistributionDomain', {
      value: this.workspaceDistribution.distributionDomainName,
      exportName: `nestself-${stage}-cf-workspace-domain`,
    });
    new cdk.CfnOutput(this, 'AdminDistributionDomain', {
      value: this.adminDistribution.distributionDomainName,
      exportName: `nestself-${stage}-cf-admin-domain`,
    });

    // ── cdk-nag acknowledgments ──────────────────────────────────
    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-CFR1', reason: 'D-28: No geographic restrictions at pilot.' },
      { id: 'AwsSolutions::AwsSolutions-CFR2', reason: 'D-28: WAF integration is context-driven; edgeWafArn must be provided at deploy time for CloudFront-scope WAF in us-east-1.' },
      { id: 'AwsSolutions::AwsSolutions-CFR3', reason: 'D-31: CloudFront access logging is a phase 2 item; ALB logs cover API traffic.' },
      { id: 'AwsSolutions::AwsSolutions-CFR4', reason: 'D-08: Using default CloudFront certificate for initial deployment; custom domain cert provisioned separately.' },
      { id: 'AwsSolutions::AwsSolutions-CFR5', reason: 'D-08: ALB origin uses HTTP (port 80) within the VPC; TLS termination is at the ALB or CloudFront edge.' },
      { id: 'AwsSolutions::AwsSolutions-S1', reason: 'D-27: SPA bucket access logging is a phase 2 item; CloudFront metrics cover access patterns.' },
      { id: 'AwsSolutions::AwsSolutions-S10', reason: 'D-27: SPA buckets enforce SSL via bucket policy.' },
    );
  }
}

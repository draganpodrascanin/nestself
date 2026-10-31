import * as cdk from 'aws-cdk-lib';

/**
 * CDK context a staging or production stack reads (CDK-setup.md section 8). The values only
 * have the shape of the real ones; none of them names a resource that exists.
 */
export const AUTH_CERTIFICATE_ARN =
  'arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-0000-0000-000000000000';
export const HOSTED_ZONE_ID = 'Z0123456789ABCDEFGHIJ';
export const CLOUDFRONT_PREFIX_LIST_ID = 'pl-0123456789abcdef0';
export const OPS_ALERT_EMAIL = 'ops@nestself.example';

/** What the auth stack of a stage with a custom domain reads. */
export const AUTH_CONTEXT = {
  authCertificateArn: AUTH_CERTIFICATE_ARN,
  hostedZoneId: HOSTED_ZONE_ID,
};

/** What the auth and compute stacks of a platform stage (staging, production) read. */
export const PLATFORM_CONTEXT = {
  ...AUTH_CONTEXT,
  cloudfrontOriginPrefixListId: CLOUDFRONT_PREFIX_LIST_ID,
  opsAlertEmail: OPS_ALERT_EMAIL,
};

/**
 * The feature flag `cdk.json` sets for `UserPoolDomainTarget`: it reads the alias target from the
 * domain's CloudFrontDistribution attribute instead of adding a Lambda-backed custom resource.
 * `testApp` sets it itself, so `auth-stack.test.ts` asserts that `cdk.json` still carries it.
 */
export const USER_POOL_DOMAIN_TARGET_FLAG =
  '@aws-cdk/aws-route53-targets:userPoolDomainNameMethodWithoutCustomResource';

/** An app that synthesizes the way `cdk synth` does for the flags that matter here, plus the given context. */
export function testApp(context: Record<string, unknown> = {}): cdk.App {
  return new cdk.App({ context: { [USER_POOL_DOMAIN_TARGET_FLAG]: true, ...context } });
}

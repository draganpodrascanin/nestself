# NestSelf CDK Infrastructure

AWS CDK project for the NestSelf platform. Defines the auth, network, data and security-baseline stacks.

## Stages

| Stage | Account | Description |
|---|---|---|
| `dev` | shared dev account | Auth stack only. Shared Cognito pool `nestself-dev`, prefix domain, no WAF, no SES, `DESTROY` removal policy, localhost callback URLs. |
| `staging` | dedicated | All four stacks. Custom domain (follow-up), WAF, SES, `RETAIN`. |
| `production` | dedicated | All four stacks. Custom domain, WAF, SES, multi-AZ RDS, VPC flow logs, `RETAIN`. |

## Prerequisites

- Node.js 22+
- pnpm (workspace install already run at repo root)
- `esbuild` (resolved from `infra/cdk/node_modules/.bin` via the PATH fix in `cdk.json`)
- AWS CDK CLI (`aws-cdk` in devDependencies, invoked via `pnpm exec cdk`)

**IAM note**: The CDK bootstrap stack (`cdk bootstrap`) must be run once per target account/region before the first deploy. The deployer needs `AdministratorAccess` or equivalent scoped permissions during bootstrap. After bootstrap, the deploy role is assumed from the bootstrap stack.

## Commands

```bash
# Synthesize dev (no AWS credentials needed)
pnpm --filter @nestself/cdk exec cdk synth -c stage=dev -c account=<ACCOUNT_ID>

# Synthesize staging offline (no credentials)
pnpm --filter @nestself/cdk exec cdk synth -c stage=staging -c account=<ACCOUNT_ID> --no-lookups

# Deploy dev auth stack
pnpm --filter @nestself/cdk exec cdk deploy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>

# Deploy all staging stacks
pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=staging -c account=<ACCOUNT_ID>

# Deploy all production stacks
pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=production -c account=<ACCOUNT_ID>

# Extract .env from deployed stack outputs
node infra/cdk/scripts/env-from-outputs.mjs --stage dev
node infra/cdk/scripts/env-from-outputs.mjs --stage dev --mobile

# Run tests / lint / typecheck
pnpm --filter @nestself/cdk test
pnpm --filter @nestself/cdk lint
pnpm --filter @nestself/cdk typecheck
```

## Dev stage resources and cost

The dev stage creates a single auth stack containing:

- 1 Cognito User Pool (Essentials plan) with prefix domain `nestself-dev`
- 3 app clients (web confidential, mobile public, M2M)
- 2 Lambda triggers (CustomMessage, PreSignUp) on ARM64/Node 22
- 2 CloudWatch Log Groups (1-week retention)
- 2 Secrets Manager secrets (web client secret, session encryption key)
- 2 AwsCustomResource-backed Lambda functions (client secret population)

**Estimated cost**: under $5/month with low usage. Cognito Essentials charges per MAU after the free tier (50 MAU free). Secrets Manager is $0.40/secret/month. Lambda and CloudWatch costs are negligible at dev scale.

## B.13 CDK property verification table

Verified against `aws-cdk-lib@2.274.0`, `cdk-nag@3.0.2`, `constructs@10.8.1`.

| Property / path | Status | Notes |
|---|---|---|
| `UserPool.mfa: OPTIONAL` | L2 supported | `cognito.Mfa.OPTIONAL` enum works directly |
| `CfnUserPool.UserPoolTier = 'ESSENTIALS'` | L2 supported | `featurePlan: cognito.FeaturePlan.ESSENTIALS` available in 2.274.0; no L1 override needed |
| `UserPool.deletionProtection` | L2 supported | `deletionProtection: true` works directly |
| `UserPoolClient.authFlows.userAuth` | L2 supported | `authFlows: { user: true }` maps to `ALLOW_USER_AUTH`; no L1 override needed |
| `CfnUserPoolClient.RefreshTokenRotation` | L2 supported | `refreshTokenRotationGracePeriod` on the L2 sets `RetryGracePeriodSeconds` |
| `CfnUserPoolClient.EnablePropagateAdditionalUserContextData` | Not used | Threat protection excluded from launch (D-01) |
| `UserPoolDomain.cloudFrontEndpoint` | Not used (dev) | Dev uses prefix domain; staging/prod custom domain is a follow-up |
| `lambda.Runtime.NODEJS_22_X` | Available | Runtime constant exists in 2.274.0 |
| `CfnManagedLoginBranding` | Not used | Branding is a follow-up task |
| WAF rate-based rule `limit: 50` | Valid | Minimum is 10 since March 2024; 50 is accepted |
| `AwsCustomResource` for `DescribeUserPoolClient` | Works | SDK call shape confirmed via successful synth |
| `webClient.userPoolClientSecret` cross-stack | Deferred | Auth stack stores secret in Secrets Manager; compute stack reads the ARN from CF outputs |

## SignInPolicy (Essentials)

The `signInPolicy.allowedFirstAuthFactors` L2 property is available in 2.274.0 for pools on the Essentials plan. It replaces the older `CfnUserPool` override for `SignInPolicy`. We set `password: true, emailOtp: true, smsOtp: false`.

## Manual steps for staging and production

1. **Bootstrap**: Run `cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1` in each target account.
2. **SES domain identity**: Verify the sending domain (`nestself.rs` / `staging.nestself.rs`) in SES before deploy.
3. **Custom Cognito domain**: Create `NestSelfEdgeStack` in us-east-1 for the ACM certificate, then wire `auth.<domain>` into the auth stack.
4. **Route 53 hosted zone**: Ensure the hosted zone for the domain exists in the target account.
5. **WAF association**: Staging/production auth stacks attach a WAF WebACL to the user pool. Verify WAF quotas.
6. **KMS keys**: The security-baseline stack creates `alias/nestself-platform`; ensure the deploy role has `kms:CreateKey`.
7. **Set `@aws-cdk/core:defaultCrossStackReferences`** to `"weak"` in `cdk.json` after first successful deploy of all stacks (currently `"both"` for the transition).

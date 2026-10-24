# NestSelf CDK Infrastructure

AWS CDK project for the NestSelf platform. Defines the auth, network, data, security-baseline, compute, edge, observability and CI stacks.

First-time setup of an AWS account, credentials, IAM permissions and the environment variables the apps need is written step by step in `CDK-setup.md` at the repository root. This file is the reference for the stacks themselves.

## Stages

| Stage | Account | Description |
|---|---|---|
| `dev` | shared dev account | Auth stack only. Shared Cognito pool `nestself-dev`, prefix domain, no WAF, no SES, `DESTROY` removal policy, localhost callback URLs. |
| `staging` | dedicated | All eight stacks. Custom domain (follow-up), WAF, SES, `RETAIN`. |
| `production` | dedicated | All eight stacks. Custom domain, WAF, SES, multi-AZ RDS, VPC flow logs, `RETAIN`. |

## Deployed environments

| Stage | Account | Status |
|---|---|---|
| `dev` | `634972095709` | **Live since 2026-10-24.** `CDKToolkit` + `NestSelf-dev-Auth`. Pool `eu-central-1_g6OGYONQ0`, hosted domain `nestself-dev`, clients `nestself-web-dev` / `nestself-mobile-dev` / `nestself-m2m-dev`, secrets `nestself-dev/cognito/web-client-secret` and `nestself-dev/api/session-encryption-key`, triggers `nestself-dev-cognito-custom-message` and `nestself-dev-cognito-pre-sign-up`. |
| `staging` | not created | Section "Manual steps for staging and production" below. |
| `production` | not created | Same. |

Credentials for dev come from the `nestself-dev` profile, which a `chpwd` hook activates inside the repository. **Never export `AWS_PROFILE` globally**: the machine's `[default]` profile is an unrelated account, and the resulting `AccessDenied` names the correct pool id with the wrong account, which reads like a pool permission problem. Check with `aws sts get-caller-identity` before deploying; it must print `634972095709`. The repository rule is in `CLAUDE.md`, the first-time setup in `CDK-setup.md`.

Teardown is three calls in order, because the stack enables deletion protection and Cognito refuses to drop a pool that still owns a domain:

```bash
aws cognito-idp update-user-pool --user-pool-id <id> --deletion-protection INACTIVE
aws cognito-idp delete-user-pool-domain --user-pool-id <id> --domain <prefix>
aws cognito-idp delete-user-pool --user-pool-id <id>
```

## Stacks

| Stack | Key resources | Deployed in |
|---|---|---|
| `NestSelfAuthStack` | Cognito user pool, app clients, Lambda triggers, WAF, Secrets Manager | All stages |
| `NestSelfSecurityBaselineStack` | KMS keys, Route 53 hosted zone, CloudTrail | staging, production |
| `NestSelfNetworkStack` | VPC, subnets, NAT, VPC endpoints | staging, production |
| `NestSelfDataStack` | RDS PostgreSQL 17, ElastiCache Valkey | staging, production |
| `NestSelfComputeStack` | ECS cluster, API/worker/marketing Fargate services, ALB, ECR repos, migrate task definition | staging, production |
| `NestSelfEdgeStack` | CloudFront distributions (workspace, admin), S3 SPA buckets, response headers policy | staging, production |
| `NestSelfObservabilityStack` | CloudWatch metric filters, alarms, SNS alarm topic | staging, production |
| `NestSelfCiStack` | GitHub Actions OIDC provider, deploy role | staging, production |

## Prerequisites

- Node.js 22+
- pnpm (workspace install already run at repo root)
- `esbuild` (resolved from `infra/cdk/node_modules/.bin` via the PATH fix in `cdk.json`)
- AWS CDK CLI (`aws-cdk` in devDependencies, invoked via `pnpm exec cdk`)

**IAM note**: The CDK bootstrap stack (`cdk bootstrap`) must be run once per target account/region before the first deploy. The deployer needs `AdministratorAccess` or equivalent scoped permissions during bootstrap. After bootstrap, the deploy role is assumed from the bootstrap stack.

## Rollout order

Deployment happens in three steps, matching the product rollout. Each step is an explicit opt-in so nothing beyond the current step is created.

| Step | When | What is deployed | Command |
|---|---|---|---|
| 1. Cognito only | Now; development stays local (Docker Compose Postgres and Redis, API on the laptop) | `NestSelf-<stage>-Auth` only: user pool, app clients, triggers, secrets | `cdk deploy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>` |
| 2. Web applications | After the first features are complete | All platform stacks (network, data, compute, edge, observability, CI) | `cdk deploy --all -c stage=staging -c account=<ACCOUNT_ID> -c platform=true` |
| 3. Mobile | After everything is verified end to end | No new stacks: the mobile client already exists in the auth stack; EAS builds point at the staging or production pool | `node infra/cdk/scripts/env-from-outputs.mjs <stage> --mobile` |

Without `-c platform=true` the CDK app contains only the auth stack for every stage, so `cdk deploy --all` and `cdk synth` touch nothing else. The CI nag gate synthesizes with `-c platform=true` so the platform stacks stay reviewed while they are not deployed.

### Step 1: connect the API to a real Cognito pool

```bash
# once per account and region
pnpm --filter @nestself/cdk exec cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1

# deploy the dev pool (auth stack only)
pnpm --filter @nestself/cdk exec cdk deploy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>

# write the pool coordinates and secrets into the API env, then switch the mode
node infra/cdk/scripts/env-from-outputs.mjs dev >> apps/api/.env
# in apps/api/.env: AUTH_MODE=cognito, REDIS_URL set (required in cognito mode), SESSION_ENCRYPTION_KEY from the stack secret
pnpm db:up && pnpm --filter @nestself/api db:migrate && pnpm --filter @nestself/api db:seed
pnpm --filter @nestself/api dev
```

The web apps keep running locally against `http://localhost:4000`; the dev pool's callback URLs already list the localhost origins.

## Commands

```bash
# Synthesize dev (no AWS credentials needed)
pnpm --filter @nestself/cdk exec cdk synth -c stage=dev -c account=<ACCOUNT_ID>

# Synthesize staging offline with the platform stacks (no credentials)
pnpm --filter @nestself/cdk exec cdk synth -c stage=staging -c account=<ACCOUNT_ID> -c platform=true --no-lookups

# Deploy dev auth stack
pnpm --filter @nestself/cdk exec cdk deploy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>

# Deploy all staging stacks (step 2 of the rollout)
pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=staging -c account=<ACCOUNT_ID> -c platform=true

# Deploy all production stacks (step 2 of the rollout)
pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=production -c account=<ACCOUNT_ID> -c platform=true

# Run the migrate task manually (staging)
aws ecs run-task \
  --cluster nestself-staging \
  --task-definition nestself-staging-migrate \
  --launch-type FARGATE \
  --network-configuration '<NETWORK_CONFIG_JSON>'

# Extract .env from deployed stack outputs
node infra/cdk/scripts/env-from-outputs.mjs dev
node infra/cdk/scripts/env-from-outputs.mjs dev --mobile

# Run tests / lint / typecheck
pnpm --filter @nestself/cdk test
pnpm --filter @nestself/cdk lint
pnpm --filter @nestself/cdk typecheck
```

## Compute stack

The compute stack creates an ECS cluster with three Fargate services and a migration task definition.

| Service | vCPU | Memory | Container port | Prod min tasks | ALB target group |
|---|---|---|---|---|---|
| `api` | 0.5 | 1 GB | 4000 | 2 | Yes, with duration-based stickiness (1 day) for Socket.IO |
| `worker` | 0.25 | 0.5 GB | None | 1 | No (runs `node dist/worker/main.js`: the BullMQ scheduler for the nightly maintenance jobs) |
| `marketing` | 0.25 | 0.5 GB | 3000 | 1 | Yes, routed by host header |

The `migrate` task definition (0.25 vCPU, 0.5 GB) runs `pnpm --filter @nestself/api db:migrate` as a one-off ECS `run-task` before each API deployment and exits when the migration completes.

ECR repositories (`nestself-{stage}-api`, `nestself-{stage}-marketing`) have scan-on-push enabled. Critical findings block deployment via the CI/CD pipeline.

Autoscaling targets: API scales on CPU (70%) and memory (80%). Marketing scales on CPU (70%).

## Edge stack

Two CloudFront distributions serve the workspace and admin SPAs from S3 with Origin Access Control (OAC). Each distribution includes:

- Default behaviour: S3 origin, 403/404 fallback to `/index.html` (SPA routing)
- `/api/*` behaviour: ALB origin, caching disabled, all headers/cookies/query strings forwarded
- `/api/ws*` behaviour: ALB origin for Socket.IO WebSocket upgrade

A shared Response Headers Policy sets HSTS (2 years, includeSubDomains, preload), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, and Referrer-Policy: strict-origin-when-cross-origin.

**WAF note**: CloudFront WAF ACLs must reside in us-east-1. The stack does not create a WAF inline (which would require the stack to be in us-east-1). Instead, pass `-c edgeWafArn=<ARN>` with a pre-provisioned WAF ACL ARN from a us-east-1 stack.

## Observability stack

Creates CloudWatch metric filters and alarms on the API log group:

| Alarm | Metric | Threshold |
|---|---|---|
| Failed sign-ins | `FailedSignIns` (metric filter) | > 50/min |
| Principal cache hit rate | `PrincipalCacheHits / (Hits + Misses)` | < 90% |
| Emergency access activated | `EmergencyAccessActivations` (metric filter `{ $.action = "emergency_access.approved" }` on the one log line the API writes per approval) | > 0 (fires on every activation) |
| ALB 5xx rate | `HTTPCode_Target_5XX_Count / RequestCount` | > 1% |
| RDS CPU | `CPUUtilization` | > 80% |
| API task count | `RunningTaskCount` | < min tasks |

All alarms notify the `nestself-{stage}-alarms` SNS topic.

## CI stack

Creates a GitHub Actions OIDC provider and a deploy role (`nestself-{stage}-github-deploy`) with least-privilege policies:

- ECR: push images, describe scan findings
- ECS: update services, register task definitions, run tasks
- S3: sync SPA buckets
- CloudFront: create invalidations
- IAM: pass task roles
- CDK: assume bootstrap roles
- CloudFormation: describe stacks

The trust policy constrains the OIDC `sub` claim: staging trusts `main` branch and pull requests; production trusts `v*` tags.

## Cost estimates

### Dev stage (auth only)

Under $5/month. Cognito Essentials charges per MAU after 50 MAU free tier. Secrets Manager is $0.40/secret/month.

### Staging/production (all stacks)

| Resource | Estimated monthly cost |
|---|---|
| ECS Fargate (2 API + 1 worker + 1 marketing) | ~$61 |
| RDS db.t4g.small (single-AZ staging) | ~$26 |
| ElastiCache cache.t4g.micro | ~$12 |
| NAT Gateway (managed, production) / fck-nat (staging) | ~$32 / ~$4 |
| CloudFront (low traffic) | ~$1 |
| ALB | ~$16 |
| Secrets Manager (4 secrets) | ~$2 |
| CloudWatch (logs, alarms) | ~$5 |
| ECR (2 repos) | ~$1 |
| **Total (staging)** | **~$128** |
| **Total (production)** | **~$156** |

Figures are estimates for eu-central-1; confirm with the AWS Pricing Calculator.

## Manual steps for staging and production

1. **Bootstrap**: Run `cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1` in each target account.
2. **SES domain identity**: Verify the sending domain in SES before deploy.
3. **Custom Cognito domain**: Create the us-east-1 ACM certificate, then wire `auth.<domain>` into the auth stack.
4. **Route 53 hosted zone**: Ensure the hosted zone exists and is delegated from the registrar.
5. **WAF for CloudFront**: Create a WAF web ACL in us-east-1 and pass its ARN as `-c edgeWafArn=<ARN>`.
6. **KMS keys**: The security-baseline stack creates `alias/nestself-platform`; ensure the deploy role has `kms:CreateKey`.
7. **GitHub Actions variables**: Set `DEPLOY_ROLE_ARN`, `ECR_REPO_URI`, `ECR_REPO_NAME`, `ECR_REPO_MARKETING_URI`, `MIGRATE_NETWORK_CONFIG`, `SPA_WORKSPACE_BUCKET`, `SPA_ADMIN_BUCKET`, `CF_WORKSPACE_DIST_ID`, `CF_ADMIN_DIST_ID` in each GitHub environment.
8. **Set `@aws-cdk/core:defaultCrossStackReferences`** to `"weak"` in `cdk.json` after first successful deploy of all stacks.

## B.13 CDK property verification table

Verified against `aws-cdk-lib@2.274.0`, `cdk-nag@3.0.2`, `constructs@10.8.1`.

| Property / path | Status | Notes |
|---|---|---|
| `UserPool.mfa: OPTIONAL` | L2 supported | `cognito.Mfa.OPTIONAL` enum works directly |
| `CfnUserPool.UserPoolTier = 'ESSENTIALS'` | L2 supported | `featurePlan: cognito.FeaturePlan.ESSENTIALS` available in 2.274.0 |
| `UserPool.deletionProtection` | L2 supported | `deletionProtection: true` works directly |
| `UserPoolClient.authFlows.userAuth` | L2 supported | `authFlows: { user: true }` maps to `ALLOW_USER_AUTH` |
| `CfnUserPoolClient.RefreshTokenRotation` | L2 supported | `refreshTokenRotationGracePeriod` sets `RetryGracePeriodSeconds` |
| `lambda.Runtime.NODEJS_22_X` | Available | Runtime constant exists in 2.274.0 |
| WAF rate-based rule `limit: 50` | Valid | Minimum is 10 since March 2024 |
| `ecs.FargateService.circuitBreaker` | L2 supported | `circuitBreaker: { enable: true, rollback: true }` |
| `ecr.Repository.imageScanOnPush` | L2 supported | `imageScanOnPush: true` |
| `cloudfront.Distribution` with S3 OAC | L2 supported | `S3BucketOrigin.withOriginAccessControl()` |
| `elbv2.ApplicationTargetGroup` stickiness | L2 + L1 override | Duration-based stickiness via `stickinessCookieDuration` |

## SignInPolicy (Essentials)

The `signInPolicy.allowedFirstAuthFactors` L2 property is available in 2.274.0 for pools on the Essentials plan. It replaces the older `CfnUserPool` override for `SignInPolicy`. We set `password: true, emailOtp: true, smsOtp: false`.

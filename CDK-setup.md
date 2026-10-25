# CDK setup: connecting NestSelf to AWS, step by step

This guide takes you from an empty AWS account to a working local API that signs people in against a real Amazon Cognito user pool. It follows the agreed rollout order: **Cognito first** (this document, everything else stays on your laptop), **web applications later** (section 8), **mobile last** (section 9). Nothing beyond the step you are on is created; the CDK app contains only the auth stack unless you ask for more.

Reference material: `infra/cdk/README.md` (what each stack contains), `docs/environment.md` (every environment variable), `docs/auth/implementation.md` section 17 (how the API uses the pool).

## 1. What you need before you start

| Item | Why | Check |
| --- | --- | --- |
| An AWS account for development (a dedicated account, not the one that will run production) | The dev stage uses a `DESTROY` removal policy and localhost callback URLs | You know the 12-digit account id |
| A user with administrator rights in that account, preferably through IAM Identity Center (SSO); an IAM user with access keys also works | `cdk bootstrap` creates IAM roles and needs administrator rights once; later deploys assume the bootstrap roles | You can sign in to the console |
| AWS CLI v2 | The CDK CLI and `env-from-outputs.mjs` read credentials and stack outputs through it | `aws --version` prints `aws-cli/2.x` |
| Node.js 22 or newer, pnpm, the repository installed (`pnpm install`) | The CDK app is TypeScript run with `tsx`; `esbuild` bundles the Lambda triggers | `pnpm --filter @nestself/cdk typecheck` passes |
| Docker Desktop (or any Postgres 17 and Redis 7) | Cognito mode requires Redis for sessions; Postgres holds users and grants | `pnpm db:up` starts both |

Region is fixed to **eu-central-1** (Frankfurt) for data residency; do not change it.

## 2. Configure AWS credentials on your machine

With IAM Identity Center (recommended):

```bash
aws configure sso --profile nestself-dev
# SSO start URL and region as given by your AWS organization, then pick the dev account
# and the AdministratorAccess permission set; default region: eu-central-1; output: json
aws sso login --profile nestself-dev
```

With an IAM user and access keys:

```bash
aws configure --profile nestself-dev
# AWS Access Key ID, AWS Secret Access Key, Default region name: eu-central-1, output: json
```

Verify and remember the account id:

```bash
export AWS_PROFILE=nestself-dev
export AWS_REGION=eu-central-1
aws sts get-caller-identity          # "Account" is your <ACCOUNT_ID>
export AWS_ACCOUNT_DEV=<ACCOUNT_ID>  # the CDK app reads this when -c account is not passed
```

Do **not** export these globally in your shell profile. `AWS_PROFILE` is read by every AWS call in every terminal, so a global export silently redirects any other project that relies on the `[default]` profile. Scope it to this repository instead, either with `direnv` and an `.envrc`, or with a `chpwd` hook in `~/.zshrc`:

```bash
NESTSELF_ROOT="$HOME/path/to/Nestself"
_nestself_aws_hook() {
  if [[ "$PWD" == "$NESTSELF_ROOT" || "$PWD" == "$NESTSELF_ROOT"/* ]]; then
    [[ -n "${_NS_AWS_ACTIVE-}" ]] && return
    _NS_AWS_PREV_PROFILE="${AWS_PROFILE-__unset__}"
    export AWS_PROFILE=nestself-dev AWS_REGION=eu-central-1 AWS_ACCOUNT_DEV=<ACCOUNT_ID>
    _NS_AWS_ACTIVE=1
  elif [[ -n "${_NS_AWS_ACTIVE-}" ]]; then
    unset AWS_ACCOUNT_DEV
    [[ "$_NS_AWS_PREV_PROFILE" == "__unset__" ]] && unset AWS_PROFILE || export AWS_PROFILE="$_NS_AWS_PREV_PROFILE"
    unset _NS_AWS_ACTIVE _NS_AWS_PREV_PROFILE
  fi
}
autoload -Uz add-zsh-hook && add-zsh-hook chpwd _nestself_aws_hook && _nestself_aws_hook
```

`AWS_REGION` matters as much as the profile: `env-from-outputs.mjs` runs `aws cloudformation describe-stacks` with neither `--region` nor `--profile`, so with the wrong ambient region it prints `Warning: output ... not found` for every value and appends empty variables without failing.

Recommended before creating the pool (OPS-R-16 in the strategy): enable CloudTrail in the dev account so Cognito administrative calls are logged from day one. The security-baseline stack does this for staging and production; for dev do it once in the console (CloudTrail, Create trail, one region, default S3 bucket) or skip it knowingly.

## 3. Bootstrap the account for CDK (once per account and region)

```bash
pnpm --filter @nestself/cdk exec cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1
```

This creates the `CDKToolkit` stack: an S3 bucket for assets, an ECR repository and the deploy roles. It needs administrator rights and takes two to three minutes. Repeat it later for the staging and production accounts.

## 4. Review what will be created, then deploy the auth stack

Synthesize first; it needs no credentials and runs the `cdk-nag` security checks:

```bash
pnpm --filter @nestself/cdk exec cdk synth -c stage=dev -c account=<ACCOUNT_ID>
```

Deploy:

```bash
pnpm --filter @nestself/cdk exec cdk deploy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>
```

Confirm the IAM changes when asked. The stack `NestSelf-dev-Auth` creates:

- the user pool `nestself-dev` on the Essentials plan: sign-in by email, first factors email one-time code and password, optional authenticator (TOTP) second factor, no self sign-up, deletion protection off (dev only);
- the hosted domain `https://nestself-dev.auth.eu-central-1.amazoncognito.com`;
- three app clients: `web` (confidential, with a secret, used by the API), `mobile` (public, PKCE, 90-day refresh tokens) and a reserved machine-to-machine client; access and id tokens live 15 minutes, web refresh tokens 30 days;
- two Lambda triggers (`CustomMessage` for the email texts, `PreSignUp` to refuse self sign-up);
- two Secrets Manager secrets: `nestself-dev/cognito/web-client-secret` and `nestself-dev/api/session-encryption-key`.

No WAF, SES, VPC, database or compute is created for dev. Cost is under five dollars a month (two secrets; Cognito is free for the first 10,000 monthly active users).

Outputs you will see at the end: `UserPoolId`, `WebClientId`, `MobileClientId`, `CognitoDomain`, `CognitoIssuer`, `CognitoRegion`, `WebClientSecretArn`, `SessionEncryptionKeyArn`.

## 5. Point the API at the pool

### 5.1 Write the pool coordinates into the API environment

```bash
cp apps/api/.env.example apps/api/.env            # if you do not have one yet
node infra/cdk/scripts/env-from-outputs.mjs dev >> apps/api/.env
```

The script reads the stack outputs and the two secrets (your profile needs `cloudformation:DescribeStacks` and `secretsmanager:GetSecretValue`; an administrator has both) and appends these lines:

```
COGNITO_REGION=eu-central-1
COGNITO_USER_POOL_ID=eu-central-1_XXXXXXXXX
COGNITO_WEB_CLIENT_ID=...
COGNITO_WEB_CLIENT_SECRET=...
COGNITO_MOBILE_CLIENT_ID=...
COGNITO_DOMAIN=https://nestself-dev.auth.eu-central-1.amazoncognito.com
COGNITO_ISSUER=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_XXXXXXXXX
SESSION_ENCRYPTION_KEY=<64 hex characters>
```

Open `apps/api/.env` and finish it by hand:

| Variable | Set to | Why |
| --- | --- | --- |
| `AUTH_MODE` | `cognito` | Switches from the fake provider to the pool |
| `REDIS_URL` | `redis://localhost:6379` | Required in cognito mode (sessions, caches, job queue) |
| `SESSION_COOKIE_INSECURE_DEV` | `true` | The web apps run on plain `http://localhost`; drops the `__Host-` prefix and `Secure` flag |
| `WORKSPACE_URL`, `ADMIN_URL`, `MARKETING_URL` | the localhost origins (defaults) | CORS, CSRF and WebSocket origin checks |
| `AWS_PROFILE` | `nestself-dev` (or export it in the shell) | The API calls Cognito admin APIs with the AWS SDK's default credential chain |
| `SES_FROM_EMAIL` | leave unset for dev | Without SES the invitation link is printed in the API log |
| `JWT_SECRET`, `FAKE_IDP_FIXED_OTP` | can stay | Ignored in cognito mode |

Remove the empty `COGNITO_*=` placeholders that came from `.env.example` so the appended values are the only ones (the last value wins, but a clean file avoids confusion).

### 5.2 Credentials and permissions for the running API

Locally the API uses the same profile as you (`AWS_PROFILE`). If you prefer a least-privilege identity for the API process, create an IAM user or role with this policy and put its keys in `apps/api/.env` as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` instead of `AWS_PROFILE`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminInitiateAuth",
        "cognito-idp:AdminRespondToAuthChallenge",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminSetUserPassword",
        "cognito-idp:AdminUserGlobalSignOut",
        "cognito-idp:GetTokensFromRefreshToken",
        "cognito-idp:RevokeToken",
        "cognito-idp:ListUsers",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:CreateIdentityProvider",
        "cognito-idp:UpdateIdentityProvider",
        "cognito-idp:DeleteIdentityProvider",
        "cognito-idp:DescribeIdentityProvider",
        "cognito-idp:ListIdentityProviders"
      ],
      "Resource": "arn:aws:cognito-idp:eu-central-1:<ACCOUNT_ID>:userpool/<USER_POOL_ID>"
    }
  ]
}
```

The `*IdentityProvider*` and `UpdateUserPoolClient` actions are for enterprise SSO: registering an employer's SAML or OIDC provider adds it to the web and mobile clients' supported identity providers.

Add `ses:SendEmail` and `ses:SendRawEmail` on your SES identity when you set `SES_FROM_EMAIL`. In AWS the same actions are granted to the ECS task role by `infra/cdk/lib/constructs/ecs-task-roles.ts`.

### 5.3 Start everything

```bash
pnpm db:up                                    # Postgres and Redis
pnpm --filter @nestself/api db:migrate
pnpm --filter @nestself/api db:seed           # sample organization, people, grants
pnpm --filter @nestself/api dev               # http://localhost:4000/api/health must report database and redis up
pnpm --filter @nestself/api worker:dev        # optional: nightly maintenance jobs on the Redis queue
```

The health endpoint must show Redis connected; in cognito mode the API refuses to start without it.

## 6. Create the first users in the pool

Self sign-up is disabled; people enter through invitations. The seed creates sample people with placeholder identity subjects, so for a first test link one sample person to a real pool user, then invite everyone else through the product.

Usernames in this pool **are** email addresses. `auth-stack.ts` sets `signInAliases: { email: true }` without `username: true`, which CDK compiles to `UsernameAttributes: ['email']`, so `AdminCreateUser` rejects a plain handle with `Username should be an email`. Cognito generates the internal username itself and it equals `sub`, so the same UUID goes into both `subject` and `cognito_username` when linking `external_identities` by hand.

Employee who signs in with an email code (`user_ivana`, the sample HR admin):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username user_ivana \
  --user-attributes Name=email,Value=<your real mailbox> Name=email_verified,Value=true \
  --message-action SUPPRESS

SUB=$(aws cognito-idp admin-get-user --user-pool-id <USER_POOL_ID> --username user_ivana \
      --query "UserAttributes[?Name=='sub'].Value" --output text)
```

Link the pool user to the sample person (the API matches on the token's `sub`):

```bash
docker compose -f docker/docker-compose.yml exec postgres psql -U nestself -d nestself -c \
  "update external_identities set subject='$SUB', cognito_username='user_ivana', email='<your real mailbox>' where user_id='user_ivana';
   update users set email='<your real mailbox>' where id='user_ivana';"
```

Use a mailbox you can read: Cognito sends the one-time code there. For a staff or expert account (`user_nikola`, `user_milica`) add a permanent password; the authenticator is enrolled at first sign-in:

```bash
aws cognito-idp admin-set-user-password --user-pool-id <USER_POOL_ID> \
  --username user_nikola --password '<a strong password>' --permanent
```

Then run a web app against the API and sign in:

```bash
echo "VITE_DATA_SOURCE=api" >> apps/workspace/.env.local   # or apps/admin/.env.local
pnpm --filter @nestself/workspace dev                        # http://localhost:5173/sign-in
```

From here on, invite real people as the HR admin (`POST /orgs/:orgId/invitations` or the admin screens); accepting an invitation creates the pool user and the identity link automatically.

## 7. Verify, operate, tear down

- `GET http://localhost:4000/api/auth/me` after sign-in returns the principal; `GET /api/health` reports both `database` and `redis` (`health.controller.ts` registers `DbHealthIndicator` and `RedisHealthIndicator`). In cognito mode the process refuses to start without Redis.
- Lambda trigger logs: CloudWatch log groups `/aws/lambda/nestself-dev-cognito-custom-message` and `...-pre-sign-up`.
- Pool users: `aws cognito-idp list-users --user-pool-id <USER_POOL_ID>`.
- Change the stack (`infra/cdk/lib/auth-stack.ts`, `lib/config.ts`) and redeploy with the same `cdk deploy` command; `cdk diff -c stage=dev -c account=<ACCOUNT_ID>` previews the change.
- Rotate the session key: create a new 64-hex value, move the old one to `SESSION_ENCRYPTION_KEY_PREVIOUS`, restart; remove the previous key after the longest session lifetime.
- Tear down dev: `pnpm --filter @nestself/cdk exec cdk destroy NestSelf-dev-Auth -c stage=dev -c account=<ACCOUNT_ID>` (the dev pool has no deletion protection; users are lost).

## 8. Later: the web applications (staging, then production)

Do this when the first features are complete. Each item is a manual prerequisite the stacks cannot create for you; the stacks themselves are deployed with one command.

1. Create the staging account; configure a profile; `cdk bootstrap aws://<STAGING_ACCOUNT_ID>/eu-central-1`.
2. Register or delegate the DNS zone `staging.nestself.rs` in Route 53 (the security-baseline stack creates the hosted zone; point the registrar at its name servers).
3. In SES (eu-central-1) verify the sending domain and request production access (out of the sandbox); `no-reply@staging.nestself.rs` is the configured sender.
4. In ACM **us-east-1** request a certificate for `auth.staging.nestself.rs` (custom Cognito domain) and the CloudFront names; validate by DNS.
5. Create a WAF web ACL in us-east-1 for CloudFront and note its ARN.
6. Deploy everything: `pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=staging -c account=<STAGING_ACCOUNT_ID> -c platform=true -c edgeWafArn=<ARN>`.
7. Run the migration task once (`aws ecs run-task ... nestself-staging-migrate`, see `infra/cdk/README.md`), then push the first images through the `deploy-staging` workflow.
8. GitHub: create the `staging` environment and set the variables the workflow reads: `DEPLOY_ROLE_ARN`, `ECR_REPO_URI`, `ECR_REPO_NAME`, `ECR_REPO_MARKETING_URI`, `MIGRATE_NETWORK_CONFIG`, `SPA_WORKSPACE_BUCKET`, `SPA_ADMIN_BUCKET`, `CF_WORKSPACE_DIST_ID`, `CF_ADMIN_DIST_ID` (all are stack outputs). The deploy role trusts `main` and pull requests for staging, `v*` tags for production.
9. API environment in ECS comes from the compute stack (Secrets Manager for `DATABASE_URL`, `REDIS_URL`, `COGNITO_WEB_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`); set `TRUST_PROXY_HOPS=1` behind the load balancer and `API_PUBLIC_URL`, `WORKSPACE_URL`, `ADMIN_URL` to the public origins.
10. Repeat for production with `-c stage=production`; enable the phase 2 security baseline (Service Control Policies, Security Hub) before real users.

## 9. Last: mobile

The mobile client already exists in the auth stack; nothing new is deployed. For a build that talks to a stage:

```bash
node infra/cdk/scripts/env-from-outputs.mjs <stage> --mobile >> apps/mobile/.env.local
echo "EXPO_PUBLIC_DATA_SOURCE=api" >> apps/mobile/.env.local
echo "EXPO_PUBLIC_API_URL=https://api.<stage domain>" >> apps/mobile/.env.local
```

This writes `EXPO_PUBLIC_COGNITO_REGION`, `EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`, `EXPO_PUBLIC_COGNITO_DOMAIN` and `EXPO_PUBLIC_COGNITO_ISSUER`. They are public values; the mobile client has no secret. In EAS put the same variables in the build profile. The callback scheme `nestself://auth/callback` is already registered on the mobile client.

## 10. Environment variables at a glance

| Where | Variable | Source |
| --- | --- | --- |
| Shell | `AWS_PROFILE`, `AWS_REGION`, `AWS_ACCOUNT_DEV` (`AWS_ACCOUNT_STAGING`, `AWS_ACCOUNT_PRODUCTION`) | you, section 2 |
| `apps/api/.env` | `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_WEB_CLIENT_ID`, `COGNITO_WEB_CLIENT_SECRET`, `COGNITO_MOBILE_CLIENT_ID`, `COGNITO_DOMAIN`, `COGNITO_ISSUER`, `SESSION_ENCRYPTION_KEY` | `env-from-outputs.mjs <stage>` |
| `apps/api/.env` | `AUTH_MODE=cognito`, `REDIS_URL`, `SESSION_COOKIE_INSECURE_DEV=true` (local only), `AWS_PROFILE` or access keys, optional `SES_FROM_EMAIL`, `IP_HASH_SALT`, `JOBS_TIMEZONE`; `API_PUBLIC_URL` (public API origin for the SSO start and callback URLs, default `http://localhost:4000`) | you, section 5 |
| `apps/workspace/.env.local`, `apps/admin/.env.local` | `VITE_DATA_SOURCE=api`, `VITE_API_URL` | you, section 6 |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_COGNITO_*`, `EXPO_PUBLIC_DATA_SOURCE=api`, `EXPO_PUBLIC_API_URL` | `env-from-outputs.mjs <stage> --mobile`, section 9 |
| GitHub environment | `DEPLOY_ROLE_ARN`, `ECR_*`, `MIGRATE_NETWORK_CONFIG`, `SPA_*_BUCKET`, `CF_*_DIST_ID` | stack outputs, section 8 |

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `cdk bootstrap` or `deploy` fails with `AccessDenied` | The profile lacks administrator rights or the SSO session expired: `aws sso login --profile nestself-dev` |
| `Unable to resolve AWS account to use` | Pass `-c account=<ACCOUNT_ID>` or export `AWS_ACCOUNT_DEV` |
| `The platform stacks are not defined for the dev stage` | `-c platform=true` is only valid for staging and production; dev is Cognito only by design |
| API refuses to start: `REDIS_URL is required when AUTH_MODE=cognito` | Start Redis (`pnpm db:up`) and set `REDIS_URL` |
| API refuses to start: `SESSION_ENCRYPTION_KEY is required` or `Must be a 64-character hex string` | Re-run `env-from-outputs.mjs dev` or `openssl rand -hex 32` |
| Sign-in fails with `No linked identity found. Complete onboarding first.` | The pool user's `sub` is not in `external_identities`; link it (section 6) or onboard through an invitation |
| `admin-create-user`: `Username should be an email` | This pool uses `UsernameAttributes: ['email']`; pass the address as `--username`. The opposite error (`Username cannot be of email format`) only appears on a pool built with `signInAliases: { username: true, email: true }` |
| `delete-user-pool`: `deletion protection is activated`, then `It has a domain configured` | Three calls in order: `update-user-pool --deletion-protection INACTIVE`, `delete-user-pool-domain`, `delete-user-pool` |
| Sign-in returns 401 `invalid_code` although the code was copied correctly | Cognito's EMAIL_OTP code is **eight** digits. Any field or schema capped at six truncates it; use `EMAIL_OTP_MIN_LENGTH`/`EMAIL_OTP_MAX_LENGTH` from `@nestself/contracts` |
| Sign-in returns 401 `invalid_challenge` after retyping the code | A wrong code may be retyped twice; `MAX_EMAIL_OTP_ATTEMPTS = 3` ends the challenge, as does a `SignInThrottle` lock on the address. Request a new code |
| Cognito calls fail with `AccessDenied` naming an account you did not deploy to | The API process did not see `AWS_PROFILE`. It must reach `process.env`: either exported in the shell that runs `pnpm dev`, or in `apps/api/.env` together with the `validateEnv` passthrough in `apps/api/src/config/env.ts` |
| The hosted Cognito domain does not resolve right after deploy | macOS caches the NXDOMAIN from any lookup made before the domain existed. `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`. `dig` bypasses the cache and will look fine while `curl` and the browser still fail |
| `Unable to locate credentials` in the API log | `AWS_PROFILE` not visible to the API process; put it in `apps/api/.env` or export it in the shell that runs `pnpm dev` |
| No email arrives | Dev has no SES; Cognito's default sender is limited to 50 messages a day and lands in spam easily. Check the Lambda trigger logs and the mailbox's spam folder |
| `cdk-nag` errors during synth | A stack change violates a rule; add a documented suppression in the stack or fix the resource. CI synthesizes with `-c platform=true` so platform stacks stay reviewed |

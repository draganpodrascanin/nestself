# CDK setup: connecting NestSelf to AWS, step by step

This guide takes you from an empty AWS account to a working local API that signs people in against a real Amazon Cognito user pool. It follows the agreed rollout order: **Cognito first** (this document, everything else stays on your laptop), **web applications later** (sections 8 and 9), **mobile last** (section 10). Nothing beyond the step you are on is created; the CDK app contains only the auth stack unless you ask for more.

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
| `SES_FROM_EMAIL` | leave unset for dev | Without SES nothing is sent and no link is logged; outside production a single invitation create returns `devToken`, so the link is `{WORKSPACE_URL}/invite/{devToken}` |
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

## 8. Staging and production: the auth custom domain and the CloudFront-only API

Staging and production differ from dev in two ways that need values the stacks cannot create. The Cognito sign-in page answers on `auth.staging.nestself.rs` (`auth.nestself.rs` in production) instead of an `amazoncognito.com` prefix, and the API's load balancer admits CloudFront only. The second one is a security requirement: the API trusts two proxies (`TRUST_PROXY_HOPS=2`: CloudFront, then the load balancer) and reads the client address from `X-Forwarded-For` at that depth, which anyone who reached the load balancer directly could forge.

The values are CDK context (`-c name=value`). A stage that lacks one does not synthesize, and the error names the missing key.

| Context key | Read by | Value | Error without it |
| --- | --- | --- | --- |
| `authCertificateArn` | auth stack, staging and production | ARN of the ACM certificate for the auth domain, issued in **us-east-1** (8.2) | `auth custom domain needs context authCertificateArn and hostedZoneId; see CDK-setup.md` |
| `hostedZoneId` | auth stack, staging and production | Id of the Route 53 hosted zone of the stage domain (8.1) | the same |
| `cloudfrontOriginPrefixListId` | compute stack, with `-c platform=true` | Id of the AWS managed prefix list `com.amazonaws.global.cloudfront.origin-facing` in eu-central-1 (8.4) | `ALB ingress from CloudFront needs context cloudfrontOriginPrefixListId; see CDK-setup.md` |
| `opsAlertEmail` | compute stack, optional | Mailbox for operational alerts such as an expiring SSO certificate (`OPS_ALERT_EMAIL`); a malformed address stops the API from starting | none: the API logs the alert and sends no mail |

Every `cdk` command (synth, diff, deploy of any stack) constructs the auth stack, so the first two values are needed even when you deploy another stack, and `cloudfrontOriginPrefixListId` is needed by every command with `-c platform=true`. Dev needs none of them.

### 8.1 The hosted zone and its id

The security-baseline stack creates the zone (`staging.nestself.rs`, `nestself.rs` in production). If it does not exist yet, deploy that stack first, into an account that exists and is bootstrapped (section 9, step 1, for staging; the same for production). The auth and compute stacks are only synthesized by this command, so the values you do not have yet can be placeholders:

```bash
pnpm --filter @nestself/cdk exec cdk deploy NestSelf-staging-SecurityBaseline \
  -c stage=staging -c account=<STAGING_ACCOUNT_ID> -c platform=true \
  -c authCertificateArn=pending -c hostedZoneId=pending -c cloudfrontOriginPrefixListId=pending
```

Point the registrar (or the parent zone) at the zone's name servers, then read the zone id:

```bash
aws route53 list-hosted-zones-by-name --dns-name staging.nestself.rs \
  --query "HostedZones[?Name=='staging.nestself.rs.'].Id" --output text
# prints /hostedzone/Z0123456789ABCDEFGHIJ ; hostedZoneId is the part after /hostedzone/
```

### 8.2 Request the certificate in us-east-1 and validate it in the zone

Cognito serves a custom domain through a CloudFront distribution it manages, and CloudFront reads certificates from **us-east-1** only, whatever the pool's region.

```bash
aws acm request-certificate --region us-east-1 --domain-name auth.staging.nestself.rs \
  --validation-method DNS --query CertificateArn --output text      # authCertificateArn
aws acm describe-certificate --region us-east-1 --certificate-arn <CERT_ARN> \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord'   # the CNAME to create
```

Create that CNAME in the zone (the ACM console's "Create records in Route 53" button does it in one click), then wait for `aws acm wait certificate-validated --region us-east-1 --certificate-arn <CERT_ARN>`.

### 8.3 An A record at the parent name

Cognito refuses a custom domain unless its parent name resolves to an A record. The parent of `auth.staging.nestself.rs` is `staging.nestself.rs`, the apex of the staging zone (`nestself.rs` for production). Create an A record there before the auth stack is deployed. Any address will do until the real record exists (CDK does not create the apex, `app.` or `admin.` records yet):

```bash
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> --change-batch \
  '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"staging.nestself.rs","Type":"A","TTL":300,"ResourceRecords":[{"Value":"198.51.100.1"}]}}]}'
```

If the name already resolves (for example the production apex once the public site is live), there is nothing to do.

The placeholder is created by hand, outside any stack. When a stack later manages the apex record (a marketing distribution, which does not exist yet), delete the placeholder just before that stack's deploy, or the deploy fails because the record already exists:

```bash
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> --change-batch \
  '{"Changes":[{"Action":"DELETE","ResourceRecordSet":{"Name":"staging.nestself.rs","Type":"A","TTL":300,"ResourceRecords":[{"Value":"198.51.100.1"}]}}]}'
```

### 8.4 The CloudFront prefix list id

```bash
aws ec2 describe-managed-prefix-lists --region eu-central-1 \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
  --query 'PrefixLists[0].PrefixListId' --output text
```

It prints `pl-...`; the id depends on the region, and the stacks are in eu-central-1.

### 8.5 Deploy with the values

```bash
pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=staging -c account=<STAGING_ACCOUNT_ID> -c platform=true \
  -c authCertificateArn=<CERT_ARN> -c hostedZoneId=<ZONE_ID> \
  -c cloudfrontOriginPrefixListId=<PREFIX_LIST_ID> -c opsAlertEmail=<OPS_MAILBOX> -c edgeWafArn=<WAF_ARN>
```

Pass the same values to every later `cdk deploy`, `diff` and `synth` of that stage. Creating the domain takes several minutes, because Cognito provisions its CloudFront distribution; the role that runs the deployment needs `cloudfront:UpdateDistribution` (the bootstrap execution role has administrator rights unless you restricted it).

What the stacks do with the values:

- **Auth stack**: the user pool domain `auth.<stage domain>` with the certificate, an A and an AAAA alias with that name in the zone, and the `CognitoDomain` output `https://auth.<stage domain>`, which `env-from-outputs.mjs` and the compute stack read as `COGNITO_DOMAIN`. Dev keeps its prefix domain.
- **Compute stack**: the api, worker and migrate tasks get `NODE_ENV=production` on every stage (no Swagger, no pretty-printed logs, no `devToken` in invitation responses), `SES_FROM_EMAIL` (`no-reply@<stage domain>`), `OPS_ALERT_EMAIL` (when `opsAlertEmail` is passed) and `TRUST_PROXY_HOPS=2`. The load balancer's security group admits TCP 80 from the CloudFront prefix list and nothing else, and its listener adds no rule of its own. Only port 80 is opened: CloudFront's origin is HTTP-only and the load balancer has no other listener. The managed prefix list counts as 55 rules against the default quota of 60 rules per security group, so a second rule (443, for a future HTTPS listener) needs a quota increase first.

### 8.6 Check after the deploy

1. Open `https://auth.staging.nestself.rs/login?response_type=code&client_id=<WEB_CLIENT_ID>&redirect_uri=<one of the web callback URLs>`: the sign-in page loads with the new certificate. Re-run `node infra/cdk/scripts/env-from-outputs.mjs staging` to get `COGNITO_DOMAIN=https://auth.staging.nestself.rs`.
2. The load balancer must not answer anyone but CloudFront. `curl -m 10 http://<AlbDnsName>/api/health` (the `AlbDnsName` output of the compute stack) has to time out, while `https://<WorkspaceDistributionDomain>/api/health` (edge stack output) answers.
3. Know the residual risk: the prefix list admits the addresses of every CloudFront distribution, not only ours. Any AWS account can point a distribution of its own at the load balancer's DNS name and reach the API without passing our edge WAF, and whether such a distribution's `X-Forwarded-For` would carry the client address at the depth the API trusts is not confirmed. A secret origin header that our distributions add and a listener rule checks would close both; it is not part of these stacks and is listed as a follow-up in `docs/auth/implementation.md` section 21.

### 8.7 The auth domain is final before the first employer

The SAML ACS URL and the OIDC redirect URI that an employer registers at its identity provider are built from the Cognito domain. Settle `auth.<stage domain>` before the first employer is onboarded; changing it later means every employer reconfigures its provider.

## 9. Later: the web applications (staging, then production)

Do this when the first features are complete. Each item is a manual prerequisite the stacks cannot create for you; the stacks themselves are deployed with one command.

1. Create the staging account; configure a profile; `cdk bootstrap aws://<STAGING_ACCOUNT_ID>/eu-central-1`.
2. Register or delegate the DNS zone `staging.nestself.rs` in Route 53 (the security-baseline stack creates the hosted zone, so deploy it first as in section 8.1; point the registrar at its name servers).
3. In SES (eu-central-1) verify the sending domain and request production access (out of the sandbox); `no-reply@staging.nestself.rs` is the configured sender.
4. In ACM **us-east-1** request the certificate for `auth.staging.nestself.rs` (custom Cognito domain, section 8.2) and, separately, the certificates for the CloudFront names; validate by DNS.
5. Create a WAF web ACL in us-east-1 for CloudFront and note its ARN.
6. Deploy everything with the values of section 8: `pnpm --filter @nestself/cdk exec cdk deploy --all -c stage=staging -c account=<STAGING_ACCOUNT_ID> -c platform=true -c authCertificateArn=<ARN> -c hostedZoneId=<ZONE_ID> -c cloudfrontOriginPrefixListId=<ID> -c opsAlertEmail=<MAILBOX> -c edgeWafArn=<ARN>`.
7. Run the migration task once (`aws ecs run-task ... nestself-staging-migrate`, see `infra/cdk/README.md`), then push the first images through the `deploy-staging` workflow.
8. GitHub: create the `staging` environment and set the variables the workflow reads: `DEPLOY_ROLE_ARN`, `ECR_REPO_URI`, `ECR_REPO_NAME`, `ECR_REPO_MARKETING_URI`, `MIGRATE_NETWORK_CONFIG`, `SPA_WORKSPACE_BUCKET`, `SPA_ADMIN_BUCKET`, `CF_WORKSPACE_DIST_ID`, `CF_ADMIN_DIST_ID` (all are stack outputs). The deploy role trusts `main` and pull requests for staging, `v*` tags for production.
9. API environment in ECS comes from the compute stack (Secrets Manager for `DATABASE_URL`, `REDIS_URL`, `COGNITO_WEB_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`); the compute stack passes `WORKSPACE_URL`, `ADMIN_URL` and `API_PUBLIC_URL` from the stage config (`lib/config.ts`: the SPAs proxy `/api`, so the API origin is the workspace origin). Browser SSO runs on each surface's own origin, so the web client's registered `webCallbackUrls` for both SPA origins are exactly what the API sends as `redirect_uri` and none is unused (`docs/auth/implementation.md` 22.3). The same stack sets `NODE_ENV=production`, `SES_FROM_EMAIL`, `OPS_ALERT_EMAIL` (from `-c opsAlertEmail`) and `TRUST_PROXY_HOPS=2` (CloudFront, then the load balancer), and the load balancer admits CloudFront only (section 8).
10. Repeat for production with `-c stage=production` (its own certificate, hosted zone id and prefix list id, looked up in the production account); enable the phase 2 security baseline (Service Control Policies, Security Hub) before real users.

## 10. Last: mobile

The mobile client already exists in the auth stack; nothing new is deployed. For a build that talks to a stage:

```bash
node infra/cdk/scripts/env-from-outputs.mjs <stage> --mobile >> apps/mobile/.env.local
echo "EXPO_PUBLIC_DATA_SOURCE=api" >> apps/mobile/.env.local
echo "EXPO_PUBLIC_API_URL=https://app.<stage domain>" >> apps/mobile/.env.local
```

The app reaches the API the way the workspace does, through the workspace distribution's `/api/*` path: `EXPO_PUBLIC_API_URL` is the stage's `API_PUBLIC_URL` (`apiPublicUrl` in `infra/cdk/lib/config.ts`). No `api.` name exists, and the load balancer would refuse a direct request anyway (section 8). This writes `EXPO_PUBLIC_COGNITO_REGION`, `EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`, `EXPO_PUBLIC_COGNITO_DOMAIN` and `EXPO_PUBLIC_COGNITO_ISSUER`. They are public values; the mobile client has no secret. In EAS put the same variables in the build profile. The callback scheme `nestself://auth/callback` is already registered on the mobile client.

## 11. Environment variables at a glance

| Where | Variable | Source |
| --- | --- | --- |
| Shell | `AWS_PROFILE`, `AWS_REGION`, `AWS_ACCOUNT_DEV` (`AWS_ACCOUNT_STAGING`, `AWS_ACCOUNT_PRODUCTION`) | you, section 2 |
| `apps/api/.env` | `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_WEB_CLIENT_ID`, `COGNITO_WEB_CLIENT_SECRET`, `COGNITO_MOBILE_CLIENT_ID`, `COGNITO_DOMAIN`, `COGNITO_ISSUER`, `SESSION_ENCRYPTION_KEY` | `env-from-outputs.mjs <stage>` |
| `apps/api/.env` | `AUTH_MODE=cognito`, `REDIS_URL`, `SESSION_COOKIE_INSECURE_DEV=true` (local only), `AWS_PROFILE` or access keys, optional `SES_FROM_EMAIL`, `IP_HASH_SALT`, `JOBS_TIMEZONE`; `API_PUBLIC_URL=http://localhost:4000`, `WORKSPACE_URL`, `ADMIN_URL` (required in cognito mode: the SSO start and callback URLs and where the callback sends the browser) | you, section 5 |
| ECS tasks (api, worker, migrate) | `NODE_ENV=production`, `SES_FROM_EMAIL`, `OPS_ALERT_EMAIL`, `TRUST_PROXY_HOPS` | compute stack: per stage from `lib/config.ts`, `OPS_ALERT_EMAIL` from `-c opsAlertEmail`, section 8 |
| CDK context (`-c`) | `authCertificateArn`, `hostedZoneId`, `cloudfrontOriginPrefixListId`, `opsAlertEmail` (besides `stage`, `account`, `platform`, `edgeWafArn`) | you, section 8 |
| `apps/workspace/.env.local`, `apps/admin/.env.local` | `VITE_DATA_SOURCE=api`, `VITE_API_URL` | you, section 6 |
| `apps/mobile/.env.local` | `EXPO_PUBLIC_COGNITO_*`, `EXPO_PUBLIC_DATA_SOURCE=api`, `EXPO_PUBLIC_API_URL` | `env-from-outputs.mjs <stage> --mobile`, section 10 |
| GitHub environment | `DEPLOY_ROLE_ARN`, `ECR_*`, `MIGRATE_NETWORK_CONFIG`, `SPA_*_BUCKET`, `CF_*_DIST_ID` | stack outputs, section 9 |

## 12. Troubleshooting

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
| `auth custom domain needs context authCertificateArn and hostedZoneId` | Staging and production construct the auth stack on every `cdk` command; pass both values (section 8). An empty value counts as missing |
| `ALB ingress from CloudFront needs context cloudfrontOriginPrefixListId` | Every command with `-c platform=true` on staging or production needs the prefix list id (section 8.4) |
| Deploying the auth stack fails creating `AWS::Cognito::UserPoolDomain` | The certificate is not in us-east-1 or is not `ISSUED` yet (section 8.2), or the parent name does not resolve to an A record (section 8.3) |
| `curl http://<AlbDnsName>/api/health` times out on staging or production | Expected: the load balancer answers CloudFront only (section 8). Test through the CloudFront distribution domain |

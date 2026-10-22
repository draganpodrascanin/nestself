import * as cdk from 'aws-cdk-lib';
import { Validations } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'node:path';
import type { Construct } from 'constructs';
import type { StageConfig } from './config.js';

export interface AuthStackProps extends cdk.StackProps {
  readonly config: StageConfig;
}

export class NestSelfAuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly webClient: cognito.UserPoolClient;
  public readonly mobileClient: cognito.UserPoolClient;
  public readonly m2mClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;
    const stage = config.stage;
    const isDev = stage === 'dev';
    const isProd = stage === 'production';

    // ── User pool ────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `nestself-${stage}`,
      signInAliases: { email: true },
      autoVerify: { email: true },
      selfSignUpEnabled: false,
      signInCaseSensitive: false,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      signInPolicy: {
        allowedFirstAuthFactors: {
          password: true,
          emailOtp: true,
          smsOtp: false,
        },
      },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        locale: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      email: config.enableSes
        ? cognito.UserPoolEmail.withSES({
            fromEmail: config.sesFromEmail!,
            fromName: 'NestSelf',
            sesRegion: 'eu-central-1',
          })
        : undefined,
      deletionProtection: config.deletionProtection,
      removalPolicy: config.removalPolicy === 'destroy'
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });
    this.userPool = userPool;

    // Pool-level L1 overrides
    const cfnPool = userPool.node.defaultChild as cognito.CfnUserPool;
    cfnPool.addPropertyOverride('UserAttributeUpdateSettings', {
      AttributesRequireVerificationBeforeUpdate: ['email'],
    });

    // ── Cognito domain ───────────────────────────────────────────────
    let cognitoDomainUrl: string;

    if (config.enableCustomDomain) {
      // Staging/production: custom domain requires a us-east-1 ACM cert and
      // hosted zone, provisioned by NestSelfEdgeStack. Placeholder URL for
      // outputs; the addDomain call is a follow-up.
      cognitoDomainUrl = `https://auth.${config.domainName}`;
    } else {
      // Dev: Cognito prefix domain
      const prefix = config.cognitoDomainPrefix ?? `nestself-${stage}`;
      userPool.addDomain('PrefixDomain', {
        cognitoDomain: { domainPrefix: prefix },
      });
      cognitoDomainUrl = `https://${prefix}.auth.eu-central-1.amazoncognito.com`;
    }

    // ── Lambda triggers ──────────────────────────────────────────────
    const triggersDir = path.join(import.meta.dirname, 'triggers');
    // esbuild binary lives in infra/cdk/node_modules/.bin. The cdk.json
    // `app` command prepends it to PATH so `pnpm exec -- esbuild` works
    // even when CDK resolves the workspace root as the project root.
    const sharedLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(5),
      environment: { STAGE: stage },
      bundling: {
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    } as const;

    const customMessageFn = new lambdaNode.NodejsFunction(this, 'CustomMessageFn', {
      ...sharedLambdaProps,
      functionName: `nestself-${stage}-cognito-custom-message`,
      entry: path.join(triggersDir, 'custom-message.ts'),
    });

    const preSignUpFn = new lambdaNode.NodejsFunction(this, 'PreSignUpFn', {
      ...sharedLambdaProps,
      functionName: `nestself-${stage}-cognito-pre-sign-up`,
      entry: path.join(triggersDir, 'pre-sign-up.ts'),
    });

    userPool.addTrigger(cognito.UserPoolOperation.CUSTOM_MESSAGE, customMessageFn);
    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFn);

    // Trigger log groups with explicit retention
    const triggerLogRetention = isProd
      ? logs.RetentionDays.ONE_MONTH
      : logs.RetentionDays.ONE_WEEK;

    new logs.LogGroup(this, 'CustomMessageLogs', {
      logGroupName: `/aws/lambda/nestself-${stage}-cognito-custom-message`,
      retention: triggerLogRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'PreSignUpLogs', {
      logGroupName: `/aws/lambda/nestself-${stage}-cognito-pre-sign-up`,
      retention: triggerLogRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Callback and logout URLs ─────────────────────────────────────
    const webCallbackUrls = [...config.webCallbackUrls];
    const webLogoutUrls = [...config.webLogoutUrls];

    if (isDev) {
      const extraCb = this.node.tryGetContext('extraCallbackUrls') as string | undefined;
      if (extraCb) {
        for (const url of extraCb.split(',')) {
          webCallbackUrls.push(`${url.trim()}/api/auth/sso/callback`);
        }
      }
      const extraLogout = this.node.tryGetContext('extraLogoutUrls') as string | undefined;
      if (extraLogout) {
        for (const url of extraLogout.split(',')) {
          webLogoutUrls.push(url.trim());
        }
      }
    }

    const mobileCallbacks = [...config.mobileCallbackUrls];
    if (isDev) {
      const ctxMobile = this.node.tryGetContext('mobileCallbackUrls') as string | undefined;
      if (ctxMobile) {
        mobileCallbacks.length = 0;
        for (const url of ctxMobile.split(',')) {
          mobileCallbacks.push(url.trim());
        }
      }
    }

    // ── Web client (confidential) ────────────────────────────────────
    const webClient = userPool.addClient('WebClient', {
      userPoolClientName: `nestself-web-${stage}`,
      generateSecret: true,
      authFlows: {
        adminUserPassword: true,
        user: true,
        userPassword: false,
        userSrp: false,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: webCallbackUrls,
        logoutUrls: webLogoutUrls,
      },
      accessTokenValidity: cdk.Duration.minutes(config.accessTokenMinutes),
      idTokenValidity: cdk.Duration.minutes(config.idTokenMinutes),
      refreshTokenValidity: cdk.Duration.days(config.webRefreshDays),
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(10),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });
    this.webClient = webClient;

    const cfnWebClient = webClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnWebClient.addPropertyOverride('AuthSessionValidity', 5);

    // ── Mobile client (public) ───────────────────────────────────────
    const mobileClient = userPool.addClient('MobileClient', {
      userPoolClientName: `nestself-mobile-${stage}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        user: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: mobileCallbacks,
        logoutUrls: mobileCallbacks,
      },
      accessTokenValidity: cdk.Duration.minutes(config.accessTokenMinutes),
      idTokenValidity: cdk.Duration.minutes(config.idTokenMinutes),
      refreshTokenValidity: cdk.Duration.days(config.mobileRefreshDays),
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(10),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });
    this.mobileClient = mobileClient;

    const cfnMobileClient = mobileClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnMobileClient.addPropertyOverride('AuthSessionValidity', 5);

    // ── M2M client (reserved) ────────────────────────────────────────
    const resourceServer = userPool.addResourceServer('M2MResourceServer', {
      identifier: `nestself-${stage}-m2m`,
      userPoolResourceServerName: `nestself-m2m-${stage}`,
      scopes: [
        new cognito.ResourceServerScope({
          scopeName: 'service',
          scopeDescription: 'Service-to-service access (reserved for future use)',
        }),
      ],
    });

    const m2mClient = userPool.addClient('M2MClient', {
      userPoolClientName: `nestself-m2m-${stage}`,
      generateSecret: true,
      authFlows: {
        userPassword: false,
        userSrp: false,
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: { clientCredentials: true, authorizationCodeGrant: false },
        scopes: [
          cognito.OAuthScope.resourceServer(resourceServer, new cognito.ResourceServerScope({
            scopeName: 'service',
            scopeDescription: 'Service-to-service access',
          })),
        ],
      },
      enableTokenRevocation: true,
    });
    this.m2mClient = m2mClient;

    // ── WAF (staging/production only) ────────────────────────────────
    if (config.enableWaf) {
      const cognitoWaf = new wafv2.CfnWebACL(this, 'CognitoWaf', {
        name: `nestself-cognito-waf-${stage}`,
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `nestself-cognito-waf-${stage}`,
          sampledRequestsEnabled: true,
        },
        rules: [
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 1,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSet',
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'KnownBadInputs',
              sampledRequestsEnabled: true,
            },
          },
          {
            name: 'CognitoAuthRateLimit',
            priority: 3,
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: 50,
                aggregateKeyType: 'IP',
                scopeDownStatement: {
                  byteMatchStatement: {
                    searchString: '/oauth2/',
                    fieldToMatch: { uriPath: {} },
                    textTransformations: [{ priority: 0, type: 'LOWERCASE' }],
                    positionalConstraint: 'STARTS_WITH',
                  },
                },
              },
            },
            visibilityConfig: {
              cloudWatchMetricsEnabled: true,
              metricName: 'CognitoAuthRateLimit',
              sampledRequestsEnabled: true,
            },
          },
        ],
      });

      new wafv2.CfnWebACLAssociation(this, 'CognitoWafAssociation', {
        webAclArn: cognitoWaf.attrArn,
        resourceArn: userPool.userPoolArn,
      });
    }

    // ── Secrets Manager ──────────────────────────────────────────────
    const webClientSecret = new secretsmanager.Secret(this, 'WebClientSecret', {
      secretName: `nestself-${stage}/cognito/web-client-secret`,
      description: 'Cognito web client secret for the BFF',
    });

    const populateWebClientSecret = new cdk.custom_resources.AwsCustomResource(
      this, 'PopulateWebClientSecret', {
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPoolClient',
          parameters: {
            UserPoolId: userPool.userPoolId,
            ClientId: webClient.userPoolClientId,
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            'PopulateWebClientSecret',
          ),
          outputPaths: ['UserPoolClient.ClientSecret'],
        },
        onUpdate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'describeUserPoolClient',
          parameters: {
            UserPoolId: userPool.userPoolId,
            ClientId: webClient.userPoolClientId,
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            'PopulateWebClientSecret',
          ),
          outputPaths: ['UserPoolClient.ClientSecret'],
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [userPool.userPoolArn],
        }),
      },
    );

    new cdk.custom_resources.AwsCustomResource(
      this, 'WriteWebClientSecret', {
        onCreate: {
          service: 'SecretsManager',
          action: 'putSecretValue',
          parameters: {
            SecretId: webClientSecret.secretArn,
            SecretString: populateWebClientSecret.getResponseField(
              'UserPoolClient.ClientSecret',
            ),
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            'WriteWebClientSecret',
          ),
        },
        onUpdate: {
          service: 'SecretsManager',
          action: 'putSecretValue',
          parameters: {
            SecretId: webClientSecret.secretArn,
            SecretString: populateWebClientSecret.getResponseField(
              'UserPoolClient.ClientSecret',
            ),
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            'WriteWebClientSecret',
          ),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['secretsmanager:PutSecretValue'],
            resources: [webClientSecret.secretArn],
          }),
        ]),
      },
    );

    // Session encryption key: 64 hex characters (0-9, a-f only)
    const sessionEncryptionKey = new secretsmanager.Secret(
      this, 'SessionEncryptionKey', {
        secretName: `nestself-${stage}/api/session-encryption-key`,
        description: 'AES-256-GCM key material for session encryption',
        generateSecretString: {
          excludePunctuation: true,
          excludeUppercase: true,
          excludeCharacters: 'ghijklmnopqrstuvwxyz',
          passwordLength: 64,
        },
      },
    );

    // ── CloudFormation outputs (B.11) ────────────────────────────────
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      exportName: `nestself-${stage}-cognito-user-pool-id`,
      description: 'COGNITO_USER_POOL_ID',
    });
    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: userPool.userPoolArn,
      exportName: `nestself-${stage}-cognito-user-pool-arn`,
    });
    new cdk.CfnOutput(this, 'WebClientId', {
      value: webClient.userPoolClientId,
      exportName: `nestself-${stage}-cognito-web-client-id`,
      description: 'COGNITO_WEB_CLIENT_ID',
    });
    new cdk.CfnOutput(this, 'MobileClientId', {
      value: mobileClient.userPoolClientId,
      exportName: `nestself-${stage}-cognito-mobile-client-id`,
      description: 'COGNITO_MOBILE_CLIENT_ID',
    });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: cognitoDomainUrl,
      exportName: `nestself-${stage}-cognito-domain`,
      description: 'COGNITO_DOMAIN',
    });
    new cdk.CfnOutput(this, 'CognitoIssuer', {
      value: `https://cognito-idp.eu-central-1.amazonaws.com/${userPool.userPoolId}`,
      exportName: `nestself-${stage}-cognito-issuer`,
      description: 'COGNITO_ISSUER',
    });
    new cdk.CfnOutput(this, 'WebClientSecretArn', {
      value: webClientSecret.secretArn,
      exportName: `nestself-${stage}-cognito-web-client-secret-arn`,
      description: 'COGNITO_WEB_CLIENT_SECRET Secrets Manager ARN',
    });
    new cdk.CfnOutput(this, 'SessionEncryptionKeyArn', {
      value: sessionEncryptionKey.secretArn,
      exportName: `nestself-${stage}-session-encryption-key-arn`,
      description: 'SESSION_ENCRYPTION_KEY Secrets Manager ARN',
    });
    new cdk.CfnOutput(this, 'CognitoRegion', {
      value: this.region,
      exportName: `nestself-${stage}-cognito-region`,
      description: 'COGNITO_REGION',
    });

    // ── cdk-nag acknowledgments ──────────────────────────────────────
    Validations.of(this).acknowledge(
      { id: 'AwsSolutions::AwsSolutions-COG2', reason: 'D-05: MFA is OPTIONAL; employees use email OTP (passwordless). Experts/staff enroll TOTP at activation.' },
      { id: 'AwsSolutions::AwsSolutions-COG1', reason: 'D-03: Password policy requires 12 chars, uppercase, lowercase, digit, symbol.' },
      { id: 'AwsSolutions::AwsSolutions-COG8', reason: 'D-01: Essentials plan is chosen; Plus is an upgrade trigger, not a launch item.' },
      { id: 'AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]', reason: 'D-30: Lambda basic execution role is AWS-managed; least-privilege task roles applied in compute stacks.' },
      { id: 'AwsSolutions::AwsSolutions-IAM5', reason: 'D-30: Custom resource policies use wildcards that CDK auto-generates for SDK actions.' },
      { id: 'AwsSolutions::AwsSolutions-L1', reason: 'Custom resource Lambda runtime is managed by CDK and may lag the latest available.' },
      { id: 'AwsSolutions::AwsSolutions-SMG4', reason: 'D-09: Web client secret is rotated yearly via runbook; session key has no auto-rotation yet.' },
    );
  }
}

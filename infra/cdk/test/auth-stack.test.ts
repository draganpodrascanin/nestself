import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import { getStageConfig } from '../lib/config.js';

function synthStack(stage: 'dev' | 'staging' | 'production'): Template {
  const app = new cdk.App();
  const config = getStageConfig(stage);
  const stack = new NestSelfAuthStack(app, `Test-${stage}-Auth`, {
    config,
    env: { account: '111111111111', region: 'eu-central-1' },
    synthesizer: new cdk.DefaultStackSynthesizer({
      generateBootstrapVersionRule: false,
    }),
  });
  return Template.fromStack(stack);
}

describe('NestSelfAuthStack -- dev stage', () => {
  const template = synthStack('dev');

  it('creates a user pool named nestself-dev', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'nestself-dev',
    });
  });

  it('sets Essentials feature plan', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolTier: 'ESSENTIALS',
    });
  });

  it('disables deletion protection for dev', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      DeletionProtection: 'INACTIVE',
    });
  });

  it('disables self sign-up', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({
        AllowAdminCreateUserOnly: true,
      }),
    });
  });

  it('creates three clients with correct names', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-mobile-dev',
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-m2m-dev',
    });
  });

  it('web client generates a secret', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      GenerateSecret: true,
    });
  });

  it('web client does NOT allow USER_PASSWORD_AUTH', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      ExplicitAuthFlows: Match.not(
        Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
      ),
    });
  });

  it('web client allows ADMIN_USER_PASSWORD_AUTH and USER_AUTH', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      ExplicitAuthFlows: Match.arrayWith([
        'ALLOW_ADMIN_USER_PASSWORD_AUTH',
        'ALLOW_USER_AUTH',
      ]),
    });
  });

  it('web client has 15-min access token', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      AccessTokenValidity: 15,
    });
  });

  it('web client has refresh token rotation enabled', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      RefreshTokenRotation: Match.objectLike({
        Feature: 'ENABLED',
        RetryGracePeriodSeconds: 10,
      }),
    });
  });

  it('mobile client is public (no secret)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-mobile-dev',
      GenerateSecret: false,
    });
  });

  it('dev callback URLs include localhost', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-dev',
      CallbackURLs: Match.arrayWith([
        'http://localhost:5173/api/auth/sso/callback',
        'http://localhost:5174/api/auth/sso/callback',
        'http://localhost:4000/api/auth/sso/callback',
      ]),
    });
  });

  it('attaches custom message trigger', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        CustomMessage: Match.anyValue(),
      }),
    });
  });

  it('attaches pre sign-up trigger', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreSignUp: Match.anyValue(),
      }),
    });
  });

  it('does NOT create a WAF for dev', () => {
    expect(template.findResources('AWS::WAFv2::WebACL')).toEqual({});
  });

  it('creates a prefix domain for dev', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'nestself-dev',
    });
  });

  it('outputs all required values', () => {
    template.hasOutput('UserPoolId', {});
    template.hasOutput('UserPoolArn', {});
    template.hasOutput('WebClientId', {});
    template.hasOutput('MobileClientId', {});
    template.hasOutput('CognitoDomain', {});
    template.hasOutput('CognitoIssuer', {});
    template.hasOutput('WebClientSecretArn', {});
    template.hasOutput('SessionEncryptionKeyArn', {});
    template.hasOutput('CognitoRegion', {});
  });
});

describe('NestSelfAuthStack -- production stage', () => {
  const template = synthStack('production');

  it('creates a user pool named nestself-production', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'nestself-production',
    });
  });

  it('enables deletion protection for production', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      DeletionProtection: 'ACTIVE',
    });
  });

  it('production web callbacks use app.nestself.rs', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'nestself-web-production',
      CallbackURLs: Match.arrayWith([
        'https://app.nestself.rs/api/auth/sso/callback',
        'https://admin.nestself.rs/api/auth/sso/callback',
      ]),
    });
  });

  it('creates a WAF for production', () => {
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  it('uses SES email configuration', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      EmailConfiguration: Match.objectLike({
        EmailSendingAccount: 'DEVELOPER',
      }),
    });
  });
});

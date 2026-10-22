#!/usr/bin/env node
/**
 * Reads CloudFormation outputs from the NestSelf auth stack and prints
 * .env lines to stdout. Does NOT write to files; pipe or append manually.
 *
 * Usage:
 *   node infra/cdk/scripts/env-from-outputs.mjs <stage>
 *   node infra/cdk/scripts/env-from-outputs.mjs dev >> apps/api/.env
 *   node infra/cdk/scripts/env-from-outputs.mjs dev --mobile >> apps/mobile/.env.local
 */

import { execSync } from 'node:child_process';

const stage = process.argv[2];
const isMobile = process.argv.includes('--mobile');

if (!stage || !['dev', 'staging', 'production'].includes(stage)) {
  console.error('Usage: env-from-outputs.mjs <dev|staging|production> [--mobile]');
  process.exit(1);
}

const stackName = `NestSelf-${stage}-Auth`;

function cfnOutput(key) {
  const raw = execSync(
    `aws cloudformation describe-stacks --stack-name ${stackName} --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" --output text`,
    { encoding: 'utf-8' },
  ).trim();
  if (!raw) {
    console.error(`Warning: output ${key} not found in stack ${stackName}`);
    return '';
  }
  return raw;
}

function secretValue(secretId) {
  return execSync(
    `aws secretsmanager get-secret-value --secret-id "${secretId}" --query SecretString --output text`,
    { encoding: 'utf-8' },
  ).trim();
}

const poolId = cfnOutput('UserPoolId');
const webClientId = cfnOutput('WebClientId');
const mobileClientId = cfnOutput('MobileClientId');
const cognitoDomain = cfnOutput('CognitoDomain');
const cognitoIssuer = cfnOutput('CognitoIssuer');
const cognitoRegion = cfnOutput('CognitoRegion');
const webSecretArn = cfnOutput('WebClientSecretArn');
const sessionKeyArn = cfnOutput('SessionEncryptionKeyArn');

if (isMobile) {
  // Mobile .env.local (Expo public vars, no secrets)
  console.log(`EXPO_PUBLIC_COGNITO_REGION=${cognitoRegion}`);
  console.log(`EXPO_PUBLIC_COGNITO_USER_POOL_ID=${poolId}`);
  console.log(`EXPO_PUBLIC_COGNITO_MOBILE_CLIENT_ID=${mobileClientId}`);
  console.log(`EXPO_PUBLIC_COGNITO_DOMAIN=${cognitoDomain}`);
  console.log(`EXPO_PUBLIC_COGNITO_ISSUER=${cognitoIssuer}`);
} else {
  // API .env (includes secrets)
  const webSecret = secretValue(webSecretArn);
  const sessionKey = secretValue(sessionKeyArn);

  console.log(`COGNITO_REGION=${cognitoRegion}`);
  console.log(`COGNITO_USER_POOL_ID=${poolId}`);
  console.log(`COGNITO_WEB_CLIENT_ID=${webClientId}`);
  console.log(`COGNITO_WEB_CLIENT_SECRET=${webSecret}`);
  console.log(`COGNITO_MOBILE_CLIENT_ID=${mobileClientId}`);
  console.log(`COGNITO_DOMAIN=${cognitoDomain}`);
  console.log(`COGNITO_ISSUER=${cognitoIssuer}`);
  console.log(`SESSION_ENCRYPTION_KEY=${sessionKey}`);
}

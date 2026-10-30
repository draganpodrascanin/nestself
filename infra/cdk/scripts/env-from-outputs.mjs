#!/usr/bin/env node
/**
 * Reads CloudFormation outputs from the NestSelf auth stack (and, for the API,
 * the video stack when it is deployed) and prints .env lines to stdout.
 * Does NOT write to files; pipe or append manually. Notes go to stderr.
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
const videoStackName = `NestSelf-${stage}-Video`;

// Video stack outputs (D-CW-31) mapped to the API env names.
const VIDEO_ENV = [
  ['CHIME_EVENTS_QUEUE_URL', 'ChimeEventsQueueUrl'],
  ['CHIME_EVENTS_QUEUE_ARN', 'ChimeEventsQueueArn'],
  ['RECORDINGS_BUCKET', 'RecordingsBucketName'],
];
const VIDEO_POLICY_OUTPUTS = ['VideoApiPolicyArn', 'VideoWorkerPolicyArn'];

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

/**
 * All outputs of the video stack as { OutputKey: OutputValue }, or null when the
 * stack does not exist in the ambient region (not deployed yet). Any other
 * failure (credentials, permissions) stops the script.
 */
function videoStackOutputs() {
  let raw;
  try {
    raw = execSync(
      `aws cloudformation describe-stacks --stack-name ${videoStackName} --query "Stacks[0].Outputs" --output json`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    if (stderr.includes('does not exist')) return null;
    console.error(stderr || error.message);
    process.exit(1);
  }
  const outputs = JSON.parse(raw) ?? [];
  return Object.fromEntries(outputs.map((o) => [o.OutputKey, o.OutputValue]));
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
  // apps/mobile/src/auth/config.ts reads EXPO_PUBLIC_COGNITO_CLIENT_ID.
  console.log(`EXPO_PUBLIC_COGNITO_CLIENT_ID=${mobileClientId}`);
  console.log(`EXPO_PUBLIC_COGNITO_DOMAIN=${cognitoDomain}`);
  console.log(`EXPO_PUBLIC_COGNITO_ISSUER=${cognitoIssuer}`);
} else {
  // API .env (includes secrets)
  const webSecret = secretValue(webSecretArn);
  const sessionKey = secretValue(sessionKeyArn);
  const video = videoStackOutputs();

  console.log(`COGNITO_REGION=${cognitoRegion}`);
  console.log(`COGNITO_USER_POOL_ID=${poolId}`);
  console.log(`COGNITO_WEB_CLIENT_ID=${webClientId}`);
  console.log(`COGNITO_WEB_CLIENT_SECRET=${webSecret}`);
  console.log(`COGNITO_MOBILE_CLIENT_ID=${mobileClientId}`);
  console.log(`COGNITO_DOMAIN=${cognitoDomain}`);
  console.log(`COGNITO_ISSUER=${cognitoIssuer}`);
  console.log(`SESSION_ENCRYPTION_KEY=${sessionKey}`);

  // The video stack is optional: never print an empty variable for it.
  const videoNames = VIDEO_ENV.map(([name]) => name).join(', ');
  if (!video) {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'the profile region';
    console.error(`Note: stack ${videoStackName} is not deployed in ${region}; skipping ${videoNames}.`);
  } else {
    for (const [name, key] of VIDEO_ENV) {
      if (video[key]) {
        console.log(`${name}=${video[key]}`);
      } else {
        console.error(`Warning: output ${key} not found in stack ${videoStackName}; skipping ${name}`);
      }
    }
    // Not env variables: the managed policies the API and worker identities need.
    for (const key of VIDEO_POLICY_OUTPUTS) {
      if (video[key]) console.error(`${key}: ${video[key]}`);
      else console.error(`Warning: output ${key} not found in stack ${videoStackName}`);
    }
  }
}

import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NestSelfEdgeStack } from '../lib/edge-stack.js';
import { NestSelfComputeStack } from '../lib/compute-stack.js';
import { NestSelfNetworkStack } from '../lib/network-stack.js';
import { NestSelfSecurityBaselineStack } from '../lib/security-baseline-stack.js';
import { NestSelfAuthStack } from '../lib/auth-stack.js';
import { getStageConfig } from '../lib/config.js';
import { PLATFORM_CONTEXT, testApp } from './context.js';

const sharedEnv = { account: '111111111111', region: 'eu-central-1' };
const synthesizerProps = {
  synthesizer: new cdk.DefaultStackSynthesizer({
    generateBootstrapVersionRule: false,
  }),
};

const CHIME_CONNECT = 'https://*.chime.aws wss://*.chime.aws https://*.sdkassets.chime.aws';

interface HeadersPolicyConfig {
  Name: string;
  SecurityHeadersConfig: {
    ContentSecurityPolicy: { ContentSecurityPolicy: string; Override: boolean };
    StrictTransportSecurity: { AccessControlMaxAgeSec: number; IncludeSubdomains: boolean; Preload: boolean; Override: boolean };
    ContentTypeOptions: { Override: boolean };
    ReferrerPolicy: { ReferrerPolicy: string; Override: boolean };
  };
  CustomHeadersConfig: { Items: { Header: string; Value: string; Override: boolean }[] };
}

/** The response headers policy called `name`, with its logical id. */
function headersPolicy(template: Template, name: string): { id: string; config: HeadersPolicyConfig } {
  const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy', {
    Properties: { ResponseHeadersPolicyConfig: { Name: name } },
  });
  const [id] = Object.keys(policies);
  expect(id, `response headers policy ${name}`).toBeDefined();
  const config = (policies[id!] as { Properties: { ResponseHeadersPolicyConfig: HeadersPolicyConfig } })
    .Properties.ResponseHeadersPolicyConfig;
  return { id: id!, config };
}

/** Directive name to source list, from a header value. */
function directives(policy: string): Record<string, string> {
  return Object.fromEntries(policy.split('; ').map((d) => {
    const [name, ...sources] = d.split(' ');
    return [name, sources.join(' ')];
  }));
}

function synthEdgeStack(stage: 'staging' | 'production'): Template {
  const app = testApp(PLATFORM_CONTEXT);
  const config = getStageConfig(stage);

  const _auth = new NestSelfAuthStack(app, `Test-${stage}-Auth`, {
    config, env: sharedEnv, ...synthesizerProps,
  });

  const security = new NestSelfSecurityBaselineStack(
    app, `Test-${stage}-Security`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const network = new NestSelfNetworkStack(
    app, `Test-${stage}-Network`, { config, env: sharedEnv, ...synthesizerProps },
  );

  const compute = new NestSelfComputeStack(app, `Test-${stage}-Compute`, {
    config, vpc: network.vpc, platformKey: security.platformKey,
    env: sharedEnv, ...synthesizerProps,
  });

  const stack = new NestSelfEdgeStack(app, `Test-${stage}-Edge`, {
    config,
    alb: compute.alb,
    platformKey: security.platformKey,
    env: sharedEnv,
    ...synthesizerProps,
  });

  return Template.fromStack(stack);
}

describe('NestSelfEdgeStack -- staging', () => {
  const template = synthEdgeStack('staging');

  it('creates two S3 buckets for workspace and admin SPAs', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  it('creates two CloudFront distributions', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 2);
  });

  it('creates one response headers policy per web app', () => {
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 2);
  });

  it('S3 buckets block public access', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('exports bucket names and distribution IDs', () => {
    template.hasOutput('WorkspaceBucketName', {});
    template.hasOutput('AdminBucketName', {});
    template.hasOutput('WorkspaceDistributionId', {});
    template.hasOutput('AdminDistributionId', {});
  });
});

describe.each([
  ['staging', 'https://app.staging.nestself.rs', 'https://admin.staging.nestself.rs'],
  ['production', 'https://app.nestself.rs', 'https://admin.nestself.rs'],
] as const)('NestSelfEdgeStack -- %s web app response headers', (stage, workspaceOrigin, adminOrigin) => {
  const template = synthEdgeStack(stage);
  const apps = [
    { app: 'workspace', origin: workspaceOrigin, distribution: 'WorkspaceDist' },
    { app: 'admin', origin: adminOrigin, distribution: 'AdminDist' },
  ] as const;

  it.each(apps)('$app: Content-Security-Policy allows Chime and the app origin as the API', ({ app, origin }) => {
    const { config } = headersPolicy(template, `nestself-${stage}-${app}-security-headers`);
    const csp = config.SecurityHeadersConfig.ContentSecurityPolicy;
    expect(csp.Override).toBe(true);
    const d = directives(csp.ContentSecurityPolicy);
    expect(d['default-src']).toBe("'self'");
    expect(d['connect-src']).toBe(`'self' ${origin} ${origin.replace('https', 'wss')} ${CHIME_CONNECT}`);
    expect(d['script-src']).toMatch(/^'self' 'wasm-unsafe-eval' blob: https:\/\/\*\.sdkassets\.chime\.aws 'sha256-[A-Za-z0-9+/=]+'$/);
    expect(d['worker-src']).toBe("'self' blob: https://*.sdkassets.chime.aws");
    expect(d['child-src']).toBe("'self' blob:");
    expect(d['frame-ancestors']).toBe("'none'");
    expect(d['object-src']).toBe("'none'");
    expect(csp.ContentSecurityPolicy).not.toContain("'unsafe-eval'");
    expect(d['script-src']).not.toContain("'unsafe-inline'");
  });

  it.each(apps)('$app: HSTS, nosniff, referrer and permissions policy', ({ app }) => {
    const { config } = headersPolicy(template, `nestself-${stage}-${app}-security-headers`);
    expect(config.SecurityHeadersConfig.StrictTransportSecurity).toEqual({
      AccessControlMaxAgeSec: 63072000,
      IncludeSubdomains: true,
      Preload: true,
      Override: true,
    });
    expect(config.SecurityHeadersConfig.ContentTypeOptions).toEqual({ Override: true });
    expect(config.SecurityHeadersConfig.ReferrerPolicy).toEqual({
      ReferrerPolicy: 'strict-origin-when-cross-origin',
      Override: true,
    });
    expect(config.CustomHeadersConfig.Items).toEqual([{
      Header: 'Permissions-Policy',
      Value: 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)',
      Override: true,
    }]);
  });

  it.each(apps)('$app: its distribution sends the policy on the SPA and /api/* behaviours', ({ app, distribution }) => {
    const { id } = headersPolicy(template, `nestself-${stage}-${app}-security-headers`);
    const distributions = template.findResources('AWS::CloudFront::Distribution');
    const distId = Object.keys(distributions).find((key) => key.startsWith(distribution));
    expect(distId).toBeDefined();
    const config = (distributions[distId!] as {
      Properties: { DistributionConfig: {
        DefaultCacheBehavior: { ResponseHeadersPolicyId: unknown };
        CacheBehaviors: { PathPattern: string; ResponseHeadersPolicyId?: unknown }[];
      } };
    }).Properties.DistributionConfig;
    expect(config.DefaultCacheBehavior.ResponseHeadersPolicyId).toEqual({ Ref: id });
    const api = config.CacheBehaviors.find((b) => b.PathPattern === '/api/*');
    expect(api?.ResponseHeadersPolicyId).toEqual({ Ref: id });
  });
});

/** Per-stage configuration for the NestSelf CDK app. */

export type Stage = 'dev' | 'staging' | 'production';

export interface StageConfig {
  readonly stage: Stage;
  readonly domainName: string;
  readonly workspaceUrl: string;
  readonly adminUrl: string;
  /** Public origin of the API (`API_PUBLIC_URL`): the SPAs proxy `/api`, so it is the workspace origin except locally. */
  readonly apiPublicUrl: string;
  readonly mobileCallbackUrls: string[];
  readonly webCallbackUrls: string[];
  readonly webLogoutUrls: string[];
  readonly sesFromEmail: string | undefined;
  readonly cognitoDomainPrefix: string | undefined;
  /** Custom domain of the Cognito hosted UI, inside the hosted zone of `domainName`; undefined keeps the `cognitoDomainPrefix` domain. */
  readonly authDomainName: string | undefined;
  /** Proxies in front of the API (`TRUST_PROXY_HOPS`): CloudFront and the ALB make 2. Above 0 the ALB admits CloudFront only. */
  readonly trustProxyHops: number;
  readonly enableWaf: boolean;
  readonly enableSes: boolean;
  readonly deletionProtection: boolean;
  readonly removalPolicy: 'destroy' | 'retain';
  readonly logRetentionDays: number;
  readonly rdsMultiAz: boolean;
  readonly rdsInstanceClass: string;
  readonly natType: 'managed' | 'fck-nat';
  readonly apiMinTasks: number;
  readonly vpcFlowLogs: boolean;
  readonly accessTokenMinutes: number;
  readonly idTokenMinutes: number;
  readonly webRefreshDays: number;
  readonly mobileRefreshDays: number;
}

const STAGE_CONFIGS: Record<Stage, StageConfig> = {
  dev: {
    stage: 'dev',
    domainName: 'nestself.rs',
    workspaceUrl: 'http://localhost:5173',
    adminUrl: 'http://localhost:5174',
    apiPublicUrl: 'http://localhost:4000',
    mobileCallbackUrls: ['nestself://auth/callback'],
    webCallbackUrls: [
      'http://localhost:5173/api/auth/sso/callback',
      'http://localhost:5174/api/auth/sso/callback',
      'http://localhost:4000/api/auth/sso/callback',
    ],
    webLogoutUrls: [
      'http://localhost:5173',
      'http://localhost:5174',
    ],
    sesFromEmail: undefined,
    cognitoDomainPrefix: 'nestself-dev',
    authDomainName: undefined,
    trustProxyHops: 0,
    enableWaf: false,
    enableSes: false,
    deletionProtection: false,
    removalPolicy: 'destroy',
    logRetentionDays: 7,
    rdsMultiAz: false,
    rdsInstanceClass: 'db.t4g.small',
    natType: 'fck-nat',
    apiMinTasks: 1,
    vpcFlowLogs: false,
    accessTokenMinutes: 15,
    idTokenMinutes: 15,
    webRefreshDays: 30,
    mobileRefreshDays: 90,
  },
  staging: {
    stage: 'staging',
    domainName: 'staging.nestself.rs',
    workspaceUrl: 'https://app.staging.nestself.rs',
    adminUrl: 'https://admin.staging.nestself.rs',
    apiPublicUrl: 'https://app.staging.nestself.rs',
    mobileCallbackUrls: ['nestself://auth/callback'],
    webCallbackUrls: [
      'https://app.staging.nestself.rs/api/auth/sso/callback',
      'https://admin.staging.nestself.rs/api/auth/sso/callback',
    ],
    webLogoutUrls: [
      'https://app.staging.nestself.rs',
      'https://admin.staging.nestself.rs',
    ],
    sesFromEmail: 'no-reply@staging.nestself.rs',
    cognitoDomainPrefix: undefined,
    authDomainName: 'auth.staging.nestself.rs',
    trustProxyHops: 2,
    enableWaf: true,
    enableSes: true,
    deletionProtection: true,
    removalPolicy: 'retain',
    logRetentionDays: 7,
    rdsMultiAz: false,
    rdsInstanceClass: 'db.t4g.small',
    natType: 'fck-nat',
    apiMinTasks: 1,
    vpcFlowLogs: false,
    accessTokenMinutes: 15,
    idTokenMinutes: 15,
    webRefreshDays: 30,
    mobileRefreshDays: 90,
  },
  production: {
    stage: 'production',
    domainName: 'nestself.rs',
    workspaceUrl: 'https://app.nestself.rs',
    adminUrl: 'https://admin.nestself.rs',
    apiPublicUrl: 'https://app.nestself.rs',
    mobileCallbackUrls: ['nestself://auth/callback'],
    webCallbackUrls: [
      'https://app.nestself.rs/api/auth/sso/callback',
      'https://admin.nestself.rs/api/auth/sso/callback',
    ],
    webLogoutUrls: [
      'https://app.nestself.rs',
      'https://admin.nestself.rs',
    ],
    sesFromEmail: 'no-reply@nestself.rs',
    cognitoDomainPrefix: undefined,
    authDomainName: 'auth.nestself.rs',
    trustProxyHops: 2,
    enableWaf: true,
    enableSes: true,
    deletionProtection: true,
    removalPolicy: 'retain',
    logRetentionDays: 30,
    rdsMultiAz: true,
    rdsInstanceClass: 'db.t4g.small',
    natType: 'managed',
    apiMinTasks: 2,
    vpcFlowLogs: true,
    accessTokenMinutes: 15,
    idTokenMinutes: 15,
    webRefreshDays: 30,
    mobileRefreshDays: 90,
  },
};

export function getStageConfig(stage: Stage): StageConfig {
  const config = STAGE_CONFIGS[stage];
  if (!config) {
    throw new Error(`Unknown stage: ${stage}. Must be one of: dev, staging, production`);
  }
  return config;
}

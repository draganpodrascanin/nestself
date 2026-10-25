/**
 * Sample-mode SSO connections, from the shared fixture without its marker.
 * Nothing here was registered with an identity provider, tested or verified.
 */
import { SAMPLE_SSO_CONNECTIONS } from '@nestself/sample-data';
import type { SsoConnectionResponse } from '@nestself/contracts';

export const SAMPLE_SSO_ROWS: SsoConnectionResponse[] = SAMPLE_SSO_CONNECTIONS.map(({ sample: _sample, ...row }) => row);

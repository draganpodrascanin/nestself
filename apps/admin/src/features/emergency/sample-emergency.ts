/**
 * Sample-mode emergency access records, from the shared fixture without its
 * marker. Nothing here was requested, approved or read.
 */
import { SAMPLE_EMERGENCY_ACCESS } from '@nestself/sample-data';
import type { EmergencyAccessResponse } from '@nestself/contracts';

export const SAMPLE_EMERGENCY_ROWS: EmergencyAccessResponse[] = SAMPLE_EMERGENCY_ACCESS.map(
  ({ sample: _sample, ...row }) => row,
);

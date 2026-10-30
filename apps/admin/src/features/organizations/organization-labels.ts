import type { OrganizationStatus } from '@nestself/contracts';
import type { BadgeTone } from '@nestself/ui';

export const ORGANIZATION_STATUS_TONE: Record<OrganizationStatus, BadgeTone> = {
  ONBOARDING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  ENDED: 'neutral',
};

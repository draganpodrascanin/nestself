export const SAMPLE_HR_PROGRAMME = {
  eligibleEmployees: 500,
  activatedAccounts: 164,
  availableFund: 1850,
  reserved: 650,
  currency: 'EUR' as const,
  teamBreakdown: {
    protected: true as const,
    reason: 'tooSmall' as const,
  },
  sample: true as const,
} as const;

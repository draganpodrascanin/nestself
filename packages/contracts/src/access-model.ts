/** The handoff's PROPOSED access matrix as data. Not a claim of enforcement. */
export const accessModel = {
  note: 'Proposed design model from the handoff. Enforcement happens server-side when the service exists; hiding UI is not access control.',
  rows: [
    {
      data: 'Conversation content',
      employee: 'Own',
      advisor: 'Assigned case only',
      hr: 'No view',
      operations: 'Exceptional, specifically authorised access only',
    },
    {
      data: 'Appointments / support history',
      employee: 'Own',
      advisor: 'Needed scope',
      hr: 'No individual view',
      operations: 'Needed operational scope',
    },
    {
      data: 'Benefit eligibility',
      employee: 'Own',
      advisor: 'As needed',
      hr: 'Eligibility administration',
      operations: 'Authorised administration',
    },
    {
      data: 'Company fund',
      employee: 'Relevant coverage',
      advisor: 'As needed for billing',
      hr: 'Programme total',
      operations: 'Authorised administration',
    },
    {
      data: 'Usage reporting',
      employee: 'Own history',
      advisor: 'Professional scope',
      hr: 'Protected aggregates',
      operations: 'Authorised scope',
    },
  ],
} as const;

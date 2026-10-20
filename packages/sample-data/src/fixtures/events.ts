export const SAMPLE_EVENT_REQUEST = {
  id: 'event_req_1',
  participants: 25,
  location: 'Novi Sad',
  options: ['bowling', 'karting', 'outdoor day'] as const,
  status: 'requested' as const,
  sample: true as const,
} as const;

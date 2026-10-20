export const SAMPLE_BOOKING = {
  advisorName: 'Milica Ristić',
  format: 'online' as const,
  date: '2026-10-21',
  appointmentAt: '2026-10-21T16:30:00+02:00',
  slots: ['10:00', '16:30', '17:30', '18:30'] as const,
  timeZone: 'Europe/Belgrade',
  price: 45,
  employerCovers: 35,
  youPay: 10,
  currency: 'EUR' as const,
  sample: true as const,
} as const;

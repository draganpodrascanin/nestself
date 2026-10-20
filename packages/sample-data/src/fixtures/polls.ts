export const SAMPLE_POLLS = [
  {
    id: 'poll_team_building',
    title: 'Team Building Activity',
    status: 'open' as const,
    teamId: 'team_product',
    options: [
      { id: 'opt_1', label: 'Bowling night', votes: 5 },
      { id: 'opt_2', label: 'Escape room', votes: 8 },
      { id: 'opt_3', label: 'Cooking class', votes: 3 },
    ],
    sample: true as const,
  },
] as const;

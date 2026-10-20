export const SAMPLE_CHANNELS = [
  {
    id: 'channel_good_news',
    name: 'Good news',
    orgId: 'org_sample',
    scope: 'org' as const,
    sample: true as const,
  },
  {
    id: 'channel_product',
    name: 'Product',
    orgId: 'org_sample',
    teamId: 'team_product',
    scope: 'team' as const,
    sample: true as const,
  },
] as const;

export const SAMPLE_POSTS = [
  {
    id: 'post_1',
    channelId: 'channel_good_news',
    authorId: 'user_jovan',
    content: 'We just closed a great partnership deal. Exciting times ahead for the team.',
    createdAt: '2026-10-05T09:00:00Z',
    sample: true as const,
  },
  {
    id: 'post_2',
    channelId: 'channel_good_news',
    authorId: 'user_ana',
    content: 'Our user satisfaction scores hit an all-time high this quarter.',
    createdAt: '2026-10-10T14:30:00Z',
    sample: true as const,
  },
  {
    id: 'post_3',
    channelId: 'channel_product',
    authorId: 'user_stefan',
    content: 'Sprint review went well. All planned features shipped on time.',
    createdAt: '2026-10-15T11:00:00Z',
    sample: true as const,
  },
  {
    id: 'post_4',
    channelId: 'channel_product',
    authorId: 'user_jovan',
    content: 'Design review for the new dashboard is scheduled for next Monday.',
    createdAt: '2026-10-18T16:45:00Z',
    sample: true as const,
  },
] as const;

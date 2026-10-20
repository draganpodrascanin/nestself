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
    content: 'Team lunch this Friday at 12:30 in the main kitchen. Everyone is welcome!',
    createdAt: '2026-10-05T09:00:00Z',
    sample: true as const,
  },
  {
    id: 'post_2',
    channelId: 'channel_good_news',
    authorId: 'user_ana',
    content: 'Welcome to Marko who joins the design team today. Say hi when you see him!',
    createdAt: '2026-10-10T14:30:00Z',
    sample: true as const,
  },
  {
    id: 'post_3',
    channelId: 'channel_product',
    authorId: 'user_stefan',
    content: 'Reminder: the wellbeing programme sign-up closes at the end of the month.',
    createdAt: '2026-10-15T11:00:00Z',
    sample: true as const,
  },
  {
    id: 'post_4',
    channelId: 'channel_product',
    authorId: 'user_jovan',
    content: 'Thank you to everyone who helped organise last week’s team-building event.',
    createdAt: '2026-10-18T16:45:00Z',
    sample: true as const,
  },
] as const;

import { assertNotProduction } from '@nestself/sample-data';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
} from '@nestself/sample-data';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

assertNotProduction(process.env);

const adapter = new PrismaPg(
  process.env.DATABASE_URL ??
    'postgresql://nestself:nestself_dev@localhost:5432/nestself',
);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Organisation
  await prisma.organization.upsert({
    where: { id: SAMPLE_ORG.id },
    update: { name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug },
    create: { id: SAMPLE_ORG.id, name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug },
  });

  // Teams
  for (const t of SAMPLE_TEAMS) {
    await prisma.team.upsert({
      where: { id: t.id },
      update: { name: t.name },
      create: { id: t.id, name: t.name, orgId: t.orgId },
    });
  }

  // Users + memberships
  for (const p of SAMPLE_PEOPLE) {
    const platformRole = p.platformRole
      ? (p.platformRole.toUpperCase() as 'EXPERT' | 'OPERATIONS' | 'ADMIN')
      : null;

    await prisma.user.upsert({
      where: { id: p.id },
      update: { displayName: p.displayName, platformRole },
      create: {
        id: p.id,
        email: `${p.id}@example.com`,
        displayName: p.displayName,
        platformRole,
      },
    });

    if (p.orgId && p.orgRole) {
      const role = p.orgRole.toUpperCase() as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
      await prisma.membership.upsert({
        where: { userId_orgId: { userId: p.id, orgId: p.orgId } },
        update: { role },
        create: { userId: p.id, orgId: p.orgId, role },
      });
    }
  }

  // Channels
  for (const ch of SAMPLE_CHANNELS) {
    const scope = ch.scope === 'org' ? 'ORGANIZATION' : 'TEAM';
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: { name: ch.name, scope },
      create: {
        id: ch.id,
        name: ch.name,
        scope,
        orgId: ch.orgId,
        teamId: 'teamId' in ch ? (ch as { teamId: string }).teamId : undefined,
      },
    });
  }

  // Posts
  for (const post of SAMPLE_POSTS) {
    await prisma.post.upsert({
      where: { id: post.id },
      update: { body: post.content },
      create: {
        id: post.id,
        body: post.content,
        channelId: post.channelId,
        authorId: post.authorId,
      },
    });
  }

  // Poll
  for (const poll of SAMPLE_POLLS) {
    await prisma.poll.upsert({
      where: { id: poll.id },
      update: { question: poll.title },
      create: { id: poll.id, question: poll.title, teamId: poll.teamId },
    });

    for (const opt of poll.options) {
      await prisma.pollOption.upsert({
        where: { id: opt.id },
        update: { label: opt.label },
        create: { id: opt.id, label: opt.label, pollId: poll.id },
      });
    }
  }

  // Experts
  for (const e of SAMPLE_EXPERTS) {
    const area = e.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    // Find a user associated with this expert by initials
    const user = SAMPLE_PEOPLE.find((p: (typeof SAMPLE_PEOPLE)[number]) => p.initials === e.initials);
    if (user) {
      await prisma.expert.upsert({
        where: { id: e.id },
        update: { area },
        create: { id: e.id, userId: user.id, area, languages: ['sr'] },
      });
    }
  }

  // Content
  for (const c of SAMPLE_CONTENT) {
    const area = c.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    await prisma.contentItem.upsert({
      where: { id: c.id },
      update: { title: c.title, summary: c.summary },
      create: {
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.summary,
        kind: 'ARTICLE',
        area,
        locale: c.locale,
      },
    });
  }

  const counts = {
    organizations: await prisma.organization.count(),
    teams: await prisma.team.count(),
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    channels: await prisma.channel.count(),
    posts: await prisma.post.count(),
    polls: await prisma.poll.count(),
    experts: await prisma.expert.count(),
    contentItems: await prisma.contentItem.count(),
  };

  console.log('Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

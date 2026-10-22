import 'dotenv/config';
import { assertNotProduction } from '@nestself/sample-data';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { seed } from './seed-lib.js';

assertNotProduction(process.env);

const adapter = new PrismaPg(
  process.env.DATABASE_URL ??
    'postgresql://nestself:nestself_dev@localhost:5432/nestself',
);
const prisma = new PrismaClient({ adapter });

seed(prisma)
  .then((counts) => {
    console.log('Seed complete:', counts);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

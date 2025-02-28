// prisma-edge.ts
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool } from '@neondatabase/serverless';

const neon = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaNeon(neon);

// @ts-expect-error - prisma client does not natively support neon so we need to pass it in manually
export const prisma = new PrismaClient({ adapter });

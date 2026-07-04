import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// node-postgres driver everywhere (Vercel functions, cron scripts, tests) — one
// driver, full transaction support, Testcontainers parity. Serverless instances
// scale horizontally, so each keeps max:1 and Neon's PgBouncer does the real pooling.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

export const db = drizzle(pool, { schema });

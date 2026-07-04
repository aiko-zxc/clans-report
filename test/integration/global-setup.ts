import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

interface ProvideContext {
  provide: (key: 'databaseUrl', value: string) => void;
}

// One postgres:17 container for the whole run (the JVM-static-container analog).
// Migrations applied once here; the URL is provided to workers, which point
// lib/db/client at it via the per-worker setup file.
export default async function setup({ provide }: ProvideContext) {
  // Ryuk (the reaper) bind-mounts the docker socket, which fails on Rancher Desktop.
  // We stop the container ourselves in teardown, so the reaper is unnecessary.
  process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';

  const container = await new PostgreSqlContainer('postgres:17').start();
  const url = container.getConnectionUri();

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();

  provide('databaseUrl', url);

  return async () => {
    await container.stop();
  };
}

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

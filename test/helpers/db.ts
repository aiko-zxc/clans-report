import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';

// Every table DatabaseHelper knows about — kept in sync with lib/db/schema.ts.
// TRUNCATE ... CASCADE resets all of them fast between tests.
const TABLES = [
  'clan_listing_playstyle_tag',
  'clan_listing_platform',
  'clan_listing',
  'bungie_member_snapshot',
  'bungie_clan_snapshot',
  'app_user',
];

export async function truncateAll(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

export { db };

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appUser } from '@/lib/db/schema';
import { bungie } from '../helpers/bungie';
import { db, truncateAll } from '../helpers/db';

beforeEach(async () => {
  await truncateAll();
});

afterEach(() => {
  bungie.resetHandlers();
});

describe('harness smoke', () => {
  it('inserts a row via the app db client and reads it back', async () => {
    const id = randomUUID();
    const now = new Date();
    await db.insert(appUser).values({
      id,
      bungieNetId: '19999999',
      displayName: 'Howler',
      displayNameCode: 1234,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const rows = await db.select().from(appUser).where(eq(appUser.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('Howler');
  });

  it('truncateAll clears rows between tests (fresh DB per test)', async () => {
    const rows = await db.select().from(appUser);
    expect(rows).toHaveLength(0);
  });
});

import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/client';
import {
  appUser,
  bungieClanSnapshot,
  clanListing,
  clanListingPlatform,
  clanListingPlaystyleTag,
} from '@/lib/db/schema';

let seq = 0;
const nextId = () => String(4000000 + ++seq); // unique 7-digit-ish Bungie-style id

export interface InsertClanOptions {
  name?: string;
  memberCount?: number;
  tags?: string[];
  platforms?: string[];
  language?: string;
  region?: string;
  membershipType?: string;
  bannerUrl?: string | null;
  updatedAt?: Date;
  fetchedAt?: Date;
}

// Inserts a fully-published clan: owner app_user + clan_listing + snapshot + tags +
// platforms. The composed shape a real publish produces, for read-path tests + seed.
export async function insertClan(opts: InsertClanOptions = {}): Promise<{
  bungieGroupId: string;
  listingId: string;
  ownerUserId: string;
}> {
  const {
    name = 'Test Clan',
    memberCount = 30,
    tags = ['PvE'],
    platforms = ['PC'],
    language = 'English',
    region = 'AMERICAS',
    membershipType = 'OPEN',
    bannerUrl = 'https://www.bungie.net/img/banner.png',
    updatedAt = new Date(),
    fetchedAt = new Date(),
  } = opts;

  const bungieGroupId = nextId();
  const ownerUserId = randomUUID();
  const listingId = randomUUID();
  const ownerDestinyId = nextId();
  const now = new Date();

  await db.insert(appUser).values({
    id: ownerUserId,
    bungieNetId: nextId(),
    displayName: 'Owner',
    displayNameCode: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  await db.insert(bungieClanSnapshot).values({
    bungieGroupId,
    name,
    motto: 'Motto',
    description: 'Description',
    bannerUrl,
    memberCount,
    clanLevel: 5,
    clanLevelMax: 6,
    membershipType,
    founderDestinyId: ownerDestinyId,
    founderMembershipType: 3,
    bungieCreatedAt: new Date('2020-01-01T00:00:00Z'),
    fetchedAt,
  });

  await db.insert(clanListing).values({
    id: listingId,
    bungieGroupId,
    ownerUserId,
    ownerDestinyId,
    ownerMembershipType: 3,
    discordUrl: 'https://discord.gg/test',
    language,
    region,
    createdAt: now,
    updatedAt,
    version: 1,
  });

  if (tags.length) {
    await db.insert(clanListingPlaystyleTag).values(tags.map((tag) => ({ clanListingId: listingId, tag })));
  }
  if (platforms.length) {
    await db
      .insert(clanListingPlatform)
      .values(platforms.map((platform) => ({ clanListingId: listingId, platform })));
  }

  return { bungieGroupId, listingId, ownerUserId };
}

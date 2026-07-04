import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  appUser,
  bungieClanSnapshot,
  bungieMemberSnapshot,
  clanListing,
  clanListingPlatform,
  clanListingPlaystyleTag,
} from '@/lib/db/schema';

// Local dev seed — fake listings so the board has something to render + varied
// data to exercise every filter. NEVER against prod (see the guard below); prod
// fills with real clans via the owner flow. Idempotent: truncates then inserts.
// Usage: npx tsx scripts/seed.ts [--clear] [--force]

const args = new Set(process.argv.slice(2));
const clearOnly = args.has('--clear');
const force = args.has('--force');

const url = process.env.DATABASE_URL ?? '';
const isLocal = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url);
if (!isLocal && !force) {
  console.error(
    `Refusing to seed a non-local database (${url.replace(/:[^:@/]+@/, ':***@')}).\n` +
      'This is a dev-only tool. Re-run with --force if you really mean it.',
  );
  process.exit(1);
}

const TABLES = [
  'clan_listing_playstyle_tag',
  'clan_listing_platform',
  'clan_listing',
  'bungie_member_snapshot',
  'bungie_clan_snapshot',
  'app_user',
];

async function truncate() {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
}

interface SeedClan {
  name: string;
  tags: string[];
  platforms: string[];
  language: string;
  region: string;
  membershipType: string;
  memberCount: number;
  clanLevel: number;
  daysAgo: number; // updatedAt offset, so sort-by-activity is visible
}

const CLANS: SeedClan[] = [
  { name: 'Moon Wolves', tags: ['PvE', 'Raids'], platforms: ['PC'], language: 'English', region: 'AMERICAS', membershipType: 'OPEN', memberCount: 42, clanLevel: 6, daysAgo: 0 },
  { name: 'Ночная Стража', tags: ['Hardcore PvE', 'Raids', 'Contest'], platforms: ['PC', 'PLAYSTATION'], language: 'Russian', region: 'EUROPE', membershipType: 'APPLICATION', memberCount: 88, clanLevel: 6, daysAgo: 1 },
  { name: 'Sonnenjäger', tags: ['Crucible', 'Hardcore PvP'], platforms: ['XBOX'], language: 'German', region: 'EUROPE', membershipType: 'OPEN', memberCount: 15, clanLevel: 4, daysAgo: 2 },
  { name: 'Lobos de la Luna', tags: ['PvPvE', 'Gambit'], platforms: ['PLAYSTATION'], language: 'Español', region: 'AMERICAS', membershipType: 'CLOSED', memberCount: 51, clanLevel: 5, daysAgo: 3 },
  { name: 'Dawnblade Collective', tags: ['PvE'], platforms: ['PC', 'XBOX', 'PLAYSTATION'], language: 'English', region: 'AMERICAS', membershipType: 'OPEN', memberCount: 100, clanLevel: 6, daysAgo: 4 },
  { name: 'Les Gardiens', tags: ['Raids', 'Low Man'], platforms: ['PC'], language: 'French', region: 'EUROPE', membershipType: 'APPLICATION', memberCount: 8, clanLevel: 3, daysAgo: 5 },
  { name: 'Світанкові', tags: ['PvE', 'Crucible'], platforms: ['PC'], language: 'Ukrainian', region: 'EUROPE', membershipType: 'OPEN', memberCount: 19, clanLevel: 4, daysAgo: 6 },
  { name: 'Straż Nocna', tags: ['Gambit', 'PvPvE'], platforms: ['PLAYSTATION', 'XBOX'], language: 'Polski', region: 'EUROPE', membershipType: 'OPEN', memberCount: 33, clanLevel: 5, daysAgo: 7 },
  { name: 'Void Runners', tags: ['Hardcore PvP', 'Contest'], platforms: ['PC'], language: 'English', region: 'ASIA_PACIFIC', membershipType: 'CLOSED', memberCount: 20, clanLevel: 5, daysAgo: 8 },
  { name: 'Southern Cross', tags: ['PvE', 'Raids', 'Gambit'], platforms: ['XBOX'], language: 'English', region: 'ASIA_PACIFIC', membershipType: 'OPEN', memberCount: 50, clanLevel: 6, daysAgo: 9 },
  { name: 'Тихий Омут', tags: ['Low Man', 'Contest'], platforms: ['PC'], language: 'Russian', region: 'EUROPE', membershipType: 'APPLICATION', memberCount: 12, clanLevel: 3, daysAgo: 10 },
  { name: 'Eclipse', tags: ['Crucible', 'Gambit', 'PvPvE'], platforms: ['PC', 'PLAYSTATION'], language: 'English', region: 'AMERICAS', membershipType: 'OPEN', memberCount: 72, clanLevel: 6, daysAgo: 11 },
];

let seq = 0;
const nid = () => String(5000000 + ++seq);

async function insert(c: SeedClan) {
  const groupId = nid();
  const ownerId = randomUUID();
  const listingId = randomUUID();
  const founderDestinyId = nid();
  const now = new Date();
  const updatedAt = new Date(now.getTime() - c.daysAgo * 86_400_000);

  await db.insert(appUser).values({
    id: ownerId, bungieNetId: nid(), displayName: `${c.name} Lead`, displayNameCode: 1,
    createdAt: now, updatedAt: now, version: 1,
  });
  await db.insert(bungieClanSnapshot).values({
    bungieGroupId: groupId, name: c.name, motto: 'For the Traveler.',
    description: `${c.name} — a ${c.language} clan.`,
    bannerUrl: 'https://www.bungie.net/img/theme/destiny/bgs/pgcrs/placeholder.jpg',
    memberCount: c.memberCount, clanLevel: c.clanLevel, clanLevelMax: 6,
    membershipType: c.membershipType, founderDestinyId, founderMembershipType: 3,
    bungieCreatedAt: new Date('2019-10-01T00:00:00Z'), fetchedAt: now,
  });
  await db.insert(clanListing).values({
    id: listingId, bungieGroupId: groupId, ownerUserId: ownerId, ownerDestinyId: founderDestinyId,
    ownerMembershipType: 3, discordUrl: 'https://discord.gg/example', language: c.language,
    region: c.region, createdAt: now, updatedAt, version: 1,
  });
  await db.insert(clanListingPlaystyleTag).values(c.tags.map((tag) => ({ clanListingId: listingId, tag })));
  await db.insert(clanListingPlatform).values(c.platforms.map((platform) => ({ clanListingId: listingId, platform })));

  const members = Math.min(c.memberCount, 8);
  await db.insert(bungieMemberSnapshot).values(
    Array.from({ length: members }, (_, i) => ({
      bungieGroupId: groupId,
      destinyId: i === 0 ? founderDestinyId : nid(),
      membershipType: 3,
      displayName: i === 0 ? `${c.name} Lead` : `Guardian ${i}`,
      displayNameCode: 1000 + i,
      iconPath: '/common/destiny2_content/icons/placeholder.png',
      fetchedAt: now,
    })),
  );
}

async function main() {
  await truncate();
  if (clearOnly) {
    console.log('Cleared all listing + snapshot tables.');
    return;
  }
  for (const c of CLANS) await insert(c);
  console.log(`Seeded ${CLANS.length} clans.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

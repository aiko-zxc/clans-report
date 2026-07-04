import { and, desc, eq, exists, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  bungieClanSnapshot,
  clanListing,
  clanListingPlatform,
  clanListingPlaystyleTag,
} from '@/lib/db/schema';
import { escapeLike } from '@/lib/like';
import type { SearchClansRequest } from '@/lib/validation';

export interface ClanCard {
  bungieGroupId: string;
  name: string;
  bannerUrl: string | null;
  memberCount: number;
  tags: string[];
}

// Board search: AND across filter categories, OR within each (flow.md V2).
// Listing joined to its snapshot (every published listing has one). Cards read
// name/banner/memberCount from the snapshot; tags are aggregated separately.
export async function searchClans(
  criteria: SearchClansRequest,
): Promise<{ items: ClanCard[]; total: number }> {
  const { name, tags, languages, regions, platforms, membershipTypes } = criteria;
  const { minMembers, maxMembers, page, pageSize } = criteria;

  const conditions = [
    name ? ilike(bungieClanSnapshot.name, `%${escapeLike(name)}%`) : undefined,
    languages.length ? inArray(clanListing.language, languages) : undefined,
    regions.length ? inArray(clanListing.region, regions) : undefined,
    membershipTypes.length
      ? inArray(bungieClanSnapshot.membershipType, membershipTypes)
      : undefined,
    minMembers != null ? gte(bungieClanSnapshot.memberCount, minMembers) : undefined,
    maxMembers != null ? lte(bungieClanSnapshot.memberCount, maxMembers) : undefined,
    tags.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(clanListingPlaystyleTag)
            .where(
              and(
                eq(clanListingPlaystyleTag.clanListingId, clanListing.id),
                inArray(clanListingPlaystyleTag.tag, tags),
              ),
            ),
        )
      : undefined,
    platforms.length
      ? exists(
          db
            .select({ one: sql`1` })
            .from(clanListingPlatform)
            .where(
              and(
                eq(clanListingPlatform.clanListingId, clanListing.id),
                inArray(clanListingPlatform.platform, platforms),
              ),
            ),
        )
      : undefined,
  ].filter((c) => c !== undefined);

  const where = conditions.length ? and(...conditions) : undefined;

  const base = db
    .select({
      id: clanListing.id,
      bungieGroupId: clanListing.bungieGroupId,
      name: bungieClanSnapshot.name,
      bannerUrl: bungieClanSnapshot.bannerUrl,
      memberCount: bungieClanSnapshot.memberCount,
    })
    .from(clanListing)
    .innerJoin(bungieClanSnapshot, eq(clanListing.bungieGroupId, bungieClanSnapshot.bungieGroupId))
    .where(where);

  const [{ total }] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(base.as('matches'));

  const rows = await base
    .orderBy(desc(clanListing.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = await attachTags(rows);
  return { items, total };
}

async function attachTags(
  rows: { id: string; bungieGroupId: string; name: string; bannerUrl: string | null; memberCount: number }[],
): Promise<ClanCard[]> {
  if (rows.length === 0) return [];

  const tagRows = await db
    .select({ clanListingId: clanListingPlaystyleTag.clanListingId, tag: clanListingPlaystyleTag.tag })
    .from(clanListingPlaystyleTag)
    .where(inArray(clanListingPlaystyleTag.clanListingId, rows.map((r) => r.id)));

  const byListing = new Map<string, string[]>();
  for (const { clanListingId, tag } of tagRows) {
    (byListing.get(clanListingId) ?? byListing.set(clanListingId, []).get(clanListingId)!).push(tag);
  }

  return rows.map((r) => ({
    bungieGroupId: r.bungieGroupId,
    name: r.name,
    bannerUrl: r.bannerUrl,
    memberCount: r.memberCount,
    tags: byListing.get(r.id) ?? [],
  }));
}

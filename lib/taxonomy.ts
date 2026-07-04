// Fixed taxonomies (see specs/clans-report.md and api.md). These are the canonical
// contract values. Languages and playstyle tags are display strings by design;
// regions, platforms, and membership types are UPPER_SNAKE_CASE enums.

export const PLAYSTYLE_TAGS = [
  'PvE',
  'Hardcore PvE',
  'PvPvE',
  'Hardcore PvP',
  'Contest',
  'Crucible',
  'Gambit',
  'Raids',
  'Low Man',
] as const;

export const LANGUAGES = [
  'English',
  'Russian',
  'German',
  'French',
  'Español',
  'Ukrainian',
  'Polski',
] as const;

export const REGIONS = ['AMERICAS', 'EUROPE', 'ASIA_PACIFIC'] as const;

export const PLATFORMS = ['PC', 'PLAYSTATION', 'XBOX'] as const;

export const MEMBERSHIP_TYPES = ['OPEN', 'APPLICATION', 'CLOSED'] as const;

export type PlaystyleTag = (typeof PLAYSTYLE_TAGS)[number];
export type Language = (typeof LANGUAGES)[number];
export type Region = (typeof REGIONS)[number];
export type Platform = (typeof PLATFORMS)[number];
export type MembershipType = (typeof MEMBERSHIP_TYPES)[number];

// Size tags derived from member count at query time — never stored (db.md).
export const SMALL_CLAN_MAX_EXCLUSIVE = 20; // < 20 members → "Small Clan"
export const BIG_CLAN_MIN_EXCLUSIVE = 50; // > 50 members → "Big Clan"

export function isSmallClan(memberCount: number): boolean {
  return memberCount < SMALL_CLAN_MAX_EXCLUSIVE;
}

export function isBigClan(memberCount: number): boolean {
  return memberCount > BIG_CLAN_MIN_EXCLUSIVE;
}

// Detail page renders a "data may be outdated" notice when the snapshot is older
// than this (cron runs every 6h; 12h gives one missed tick of grace) — flow.md.
export const STALENESS_THRESHOLD_MS = 12 * 60 * 60 * 1000;

export function isStale(fetchedAt: Date, now: Date): boolean {
  return now.getTime() - fetchedAt.getTime() > STALENESS_THRESHOLD_MS;
}

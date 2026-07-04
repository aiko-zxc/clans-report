import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Conventions (see specs/db.md): UUID PKs generated app-side; Bungie IDs as text
// (19-digit numeric strings, kept as text to match Bungie's API contract);
// membership types as int; timestamps as timestamptz UTC; enums as text validated
// at the app layer. All mutable app rows carry created_at/updated_at/version.

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey(),
    bungieNetId: text('bungie_net_id').notNull(),
    displayName: text('display_name'),
    displayNameCode: integer('display_name_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    version: integer('version').notNull(),
  },
  (t) => [uniqueIndex('app_user_bungie_net_id_uk').on(t.bungieNetId)],
);

export const clanListing = pgTable(
  'clan_listing',
  {
    id: uuid('id').primaryKey(),
    bungieGroupId: text('bungie_group_id').notNull(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => appUser.id),
    ownerDestinyId: text('owner_destiny_id').notNull(),
    ownerMembershipType: integer('owner_membership_type').notNull(),
    discordUrl: text('discord_url'),
    language: text('language').notNull(),
    region: text('region').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    uniqueIndex('clan_listing_bungie_group_id_uk').on(t.bungieGroupId),
    index('clan_listing_owner_user_id_idx').on(t.ownerUserId),
    index('clan_listing_updated_at_idx').on(t.updatedAt.desc()),
  ],
);

export const clanListingPlaystyleTag = pgTable(
  'clan_listing_playstyle_tag',
  {
    clanListingId: uuid('clan_listing_id')
      .notNull()
      .references(() => clanListing.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clanListingId, t.tag] }),
    index('clan_listing_playstyle_tag_tag_idx').on(t.tag),
  ],
);

export const clanListingPlatform = pgTable(
  'clan_listing_platform',
  {
    clanListingId: uuid('clan_listing_id')
      .notNull()
      .references(() => clanListing.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.clanListingId, t.platform] }),
    index('clan_listing_platform_platform_idx').on(t.platform),
  ],
);

export const bungieClanSnapshot = pgTable(
  'bungie_clan_snapshot',
  {
    bungieGroupId: text('bungie_group_id').primaryKey(),
    name: text('name').notNull(),
    motto: text('motto'),
    description: text('description'),
    bannerUrl: text('banner_url'),
    memberCount: integer('member_count').notNull(),
    clanLevel: integer('clan_level'),
    clanLevelMax: integer('clan_level_max'),
    membershipType: text('membership_type').notNull(),
    founderDestinyId: text('founder_destiny_id').notNull(),
    founderMembershipType: integer('founder_membership_type').notNull(),
    bungieCreatedAt: timestamp('bungie_created_at', { withTimezone: true }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('bungie_clan_snapshot_member_count_idx').on(t.memberCount),
    index('bungie_clan_snapshot_membership_type_idx').on(t.membershipType),
  ],
);

export const bungieMemberSnapshot = pgTable(
  'bungie_member_snapshot',
  {
    bungieGroupId: text('bungie_group_id').notNull(),
    destinyId: text('destiny_id').notNull(),
    membershipType: integer('membership_type').notNull(),
    displayName: text('display_name'),
    displayNameCode: integer('display_name_code'),
    iconPath: text('icon_path'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bungieGroupId, t.destinyId] }),
    index('bungie_member_snapshot_group_idx').on(t.bungieGroupId),
  ],
);

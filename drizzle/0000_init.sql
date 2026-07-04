CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bungie_net_id" text NOT NULL,
	"display_name" text,
	"display_name_code" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bungie_clan_snapshot" (
	"bungie_group_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"motto" text,
	"description" text,
	"banner_url" text,
	"member_count" integer NOT NULL,
	"clan_level" integer,
	"clan_level_max" integer,
	"membership_type" text NOT NULL,
	"founder_destiny_id" text NOT NULL,
	"founder_membership_type" integer NOT NULL,
	"bungie_created_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bungie_member_snapshot" (
	"bungie_group_id" text NOT NULL,
	"destiny_id" text NOT NULL,
	"membership_type" integer NOT NULL,
	"display_name" text,
	"display_name_code" integer,
	"icon_path" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bungie_member_snapshot_bungie_group_id_destiny_id_pk" PRIMARY KEY("bungie_group_id","destiny_id")
);
--> statement-breakpoint
CREATE TABLE "clan_listing" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bungie_group_id" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"owner_destiny_id" text NOT NULL,
	"owner_membership_type" integer NOT NULL,
	"discord_url" text,
	"language" text NOT NULL,
	"region" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clan_listing_platform" (
	"clan_listing_id" uuid NOT NULL,
	"platform" text NOT NULL,
	CONSTRAINT "clan_listing_platform_clan_listing_id_platform_pk" PRIMARY KEY("clan_listing_id","platform")
);
--> statement-breakpoint
CREATE TABLE "clan_listing_playstyle_tag" (
	"clan_listing_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "clan_listing_playstyle_tag_clan_listing_id_tag_pk" PRIMARY KEY("clan_listing_id","tag")
);
--> statement-breakpoint
ALTER TABLE "clan_listing" ADD CONSTRAINT "clan_listing_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_listing_platform" ADD CONSTRAINT "clan_listing_platform_clan_listing_id_clan_listing_id_fk" FOREIGN KEY ("clan_listing_id") REFERENCES "public"."clan_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clan_listing_playstyle_tag" ADD CONSTRAINT "clan_listing_playstyle_tag_clan_listing_id_clan_listing_id_fk" FOREIGN KEY ("clan_listing_id") REFERENCES "public"."clan_listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_bungie_net_id_uk" ON "app_user" USING btree ("bungie_net_id");--> statement-breakpoint
CREATE INDEX "bungie_clan_snapshot_member_count_idx" ON "bungie_clan_snapshot" USING btree ("member_count");--> statement-breakpoint
CREATE INDEX "bungie_clan_snapshot_membership_type_idx" ON "bungie_clan_snapshot" USING btree ("membership_type");--> statement-breakpoint
CREATE INDEX "bungie_member_snapshot_group_idx" ON "bungie_member_snapshot" USING btree ("bungie_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clan_listing_bungie_group_id_uk" ON "clan_listing" USING btree ("bungie_group_id");--> statement-breakpoint
CREATE INDEX "clan_listing_owner_user_id_idx" ON "clan_listing" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "clan_listing_updated_at_idx" ON "clan_listing" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "clan_listing_platform_platform_idx" ON "clan_listing_platform" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "clan_listing_playstyle_tag_tag_idx" ON "clan_listing_playstyle_tag" USING btree ("tag");
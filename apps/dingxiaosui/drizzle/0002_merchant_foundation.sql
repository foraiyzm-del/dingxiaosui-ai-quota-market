CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`verified_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "identity_provider" CHECK("auth_identities"."provider" IN ('sites','local-test'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_provider_subject` ON `auth_identities` (`provider`,`subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `identity_user_provider` ON `auth_identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `merchant_memberships` (
	`merchant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`merchant_id`, `user_id`),
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_role" CHECK("merchant_memberships"."role" IN ('owner','member')),
	CONSTRAINT "membership_status" CHECK("merchant_memberships"."status" IN ('active','disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_owner` ON `merchant_memberships` (`merchant_id`) WHERE "merchant_memberships"."role" = 'owner' AND "merchant_memberships"."status" = 'active';--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "merchant_status" CHECK("merchants"."status" IN ('active','disabled'))
);
--> statement-breakpoint
CREATE TABLE `merchant_shops` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`public_contact` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "shop_slug" CHECK(length("merchant_shops"."slug") BETWEEN 3 AND 64 AND "merchant_shops"."slug" NOT GLOB '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_shop_per_merchant` ON `merchant_shops` (`merchant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shop_public_slug` ON `merchant_shops` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_status" CHECK("users"."status" IN ('active','disabled'))
);

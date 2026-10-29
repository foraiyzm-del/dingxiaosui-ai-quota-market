CREATE TABLE `community_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `community_posts` ADD `kind` text DEFAULT 'discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_posts` ADD `province` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_posts` ADD `owner_hash` text DEFAULT '' NOT NULL;
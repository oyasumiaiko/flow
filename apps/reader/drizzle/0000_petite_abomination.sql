CREATE TABLE `books` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`content_sha256` text NOT NULL,
	`object_key` text NOT NULL,
	`cover_object_key` text,
	`metadata_json` text NOT NULL,
	`cfi` text,
	`percentage_ppm` integer,
	`definitions_json` text DEFAULT '[]' NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	`configuration_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_books_user_hash` ON `books` (`user_id`,`content_sha256`);--> statement-breakpoint
CREATE INDEX `idx_books_user_updated` ON `books` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);

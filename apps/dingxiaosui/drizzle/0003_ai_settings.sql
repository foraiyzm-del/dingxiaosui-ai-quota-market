CREATE TABLE `ai_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`key_cipher` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`json_mode` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	CONSTRAINT "ai_single_config" CHECK("ai_settings"."id"=1),
	CONSTRAINT "ai_kind" CHECK("ai_settings"."kind" IN ('openai-compatible','qwen','ark')),
	CONSTRAINT "ai_enabled" CHECK("ai_settings"."enabled" IN (0,1)),
	CONSTRAINT "ai_json_mode" CHECK("ai_settings"."json_mode" IN (0,1))
);

CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`turn_id` text,
	`event_type` text NOT NULL,
	`from_state` text,
	`to_state` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`latency_ms` integer,
	`model` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`estimated_cost_microusd` integer,
	`idempotency_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `interview_turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_idempotency_key_uq` ON `agent_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_events_interview_created_idx` ON `agent_events` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_events_type_created_idx` ON `agent_events` (`event_type`,`created_at`);--> statement-breakpoint
CREATE TABLE `interview_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`question_id` text,
	`question_text` text NOT NULL,
	`skill` text NOT NULL,
	`question_type` text DEFAULT 'adaptive' NOT NULL,
	`answer_text` text DEFAULT '' NOT NULL,
	`input_mode` text DEFAULT 'voice' NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`transcript_confidence` real,
	`evidence` text DEFAULT '[]' NOT NULL,
	`evaluation` text DEFAULT '{}' NOT NULL,
	`reliability` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_turns_interview_sequence_uq` ON `interview_turns` (`interview_id`,`sequence_number`);--> statement-breakpoint
CREATE INDEX `interview_turns_interview_created_idx` ON `interview_turns` (`interview_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `interview_turns_interview_skill_idx` ON `interview_turns` (`interview_id`,`skill`);--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`job_title` text NOT NULL,
	`job_description` text NOT NULL,
	`candidate_background` text DEFAULT '' NOT NULL,
	`duration_minutes` integer DEFAULT 15 NOT NULL,
	`camera_enabled` integer DEFAULT true NOT NULL,
	`recording_enabled` integer DEFAULT false NOT NULL,
	`mode` text DEFAULT 'diagnostic' NOT NULL,
	`status` text DEFAULT 'CREATED' NOT NULL,
	`current_stage` text DEFAULT 'CREATED' NOT NULL,
	`current_question_id` text,
	`checkpoint` text DEFAULT '{}' NOT NULL,
	`checkpoint_version` integer DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`verification_count` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`completed_at` text,
	`last_checkpoint_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `interviews_status_updated_idx` ON `interviews` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `interviews_created_at_idx` ON `interviews` (`created_at`);--> statement-breakpoint
CREATE TABLE `skill_states` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`skill` text NOT NULL,
	`posterior_mean` real DEFAULT 0 NOT NULL,
	`uncertainty` real DEFAULT 1 NOT NULL,
	`posterior` text DEFAULT '[]' NOT NULL,
	`supporting_evidence` text DEFAULT '[]' NOT NULL,
	`common_errors` text DEFAULT '[]' NOT NULL,
	`source_turn_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_states_interview_skill_uq` ON `skill_states` (`interview_id`,`skill`);--> statement-breakpoint
CREATE INDEX `skill_states_interview_updated_idx` ON `skill_states` (`interview_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `user_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`interview_id` text NOT NULL,
	`rating` integer,
	`would_use_again` integer,
	`comment` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `interviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_feedback_interview_created_idx` ON `user_feedback` (`interview_id`,`created_at`);
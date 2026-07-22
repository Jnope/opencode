CREATE TABLE `mcp_result` (
	`id` text PRIMARY KEY,
	`part_id` text NOT NULL,
	`session_id` text NOT NULL,
	`server_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_mcp_result_part_id_part_id_fk` FOREIGN KEY (`part_id`) REFERENCES `part`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_mcp_result_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `mcp_result_part_idx` ON `mcp_result` (`part_id`);--> statement-breakpoint
CREATE INDEX `mcp_result_session_idx` ON `mcp_result` (`session_id`);
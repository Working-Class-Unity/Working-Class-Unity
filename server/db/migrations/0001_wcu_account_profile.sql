ALTER TABLE `user` ADD `first_name` text CONSTRAINT "user_first_name_check" CHECK(`first_name` is null or (`first_name` = trim(`first_name`) and length(`first_name`) between 1 and 100));--> statement-breakpoint
ALTER TABLE `user` ADD `last_name` text CONSTRAINT "user_last_name_check" CHECK(`last_name` is null or (`last_name` = trim(`last_name`) and length(`last_name`) between 1 and 100));--> statement-breakpoint
ALTER TABLE `user` ADD `display_name` text CONSTRAINT "user_display_name_check" CHECK(`display_name` is null or (`display_name` = trim(`display_name`) and length(`display_name`) between 1 and 100));--> statement-breakpoint
UPDATE `user` SET `display_name` = `name`, `name` = 'WCU account';

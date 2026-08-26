ALTER TABLE `user` ADD `phone_number` text CONSTRAINT "user_phone_number_check" CHECK(`phone_number` is null or (`phone_number` glob '+1[2-9][0-9][0-9][2-9][0-9][0-9][0-9][0-9][0-9][0-9]' and length(`phone_number`) = 12));--> statement-breakpoint
ALTER TABLE `user` ADD `phone_number_verified` integer DEFAULT false NOT NULL CONSTRAINT "user_phone_verification_check" CHECK(`phone_number_verified` = 0 or `phone_number` is not null);--> statement-breakpoint
CREATE UNIQUE INDEX `user_phone_number_idx` ON `user` (`phone_number`);

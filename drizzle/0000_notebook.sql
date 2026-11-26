CREATE TABLE `notebook_entries` (
  `owner_id` text NOT NULL,
  `entry_id` text NOT NULL,
  `record` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  PRIMARY KEY(`owner_id`, `entry_id`)
);

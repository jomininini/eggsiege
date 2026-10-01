-- Cloud profile, progress and match history for 金蛋争夺战.
CREATE TABLE IF NOT EXISTS `player_profiles` (
`userId` int NOT NULL,
`callsign` varchar(24) NOT NULL,
`settings` json,
`xp` int NOT NULL DEFAULT 0,
`matches` int NOT NULL DEFAULT 0,
`wins` int NOT NULL DEFAULT 0,
`losses` int NOT NULL DEFAULT 0,
`draws` int NOT NULL DEFAULT 0,
`kills` int NOT NULL DEFAULT 0,
`deaths` int NOT NULL DEFAULT 0,
`captures` int NOT NULL DEFAULT 0,
`headshots` int NOT NULL DEFAULT 0,
`damage` bigint NOT NULL DEFAULT 0,
`bestKills` int NOT NULL DEFAULT 0,
`playSeconds` int NOT NULL DEFAULT 0,
`importedLocal` tinyint NOT NULL DEFAULT 0,
`lastMatchAt` timestamp NULL DEFAULT NULL,
`createdAt` timestamp NOT NULL DEFAULT (now()),
`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
CONSTRAINT `player_profiles_pk` PRIMARY KEY(`userId`)
);

CREATE TABLE IF NOT EXISTS `match_records` (
`id` int AUTO_INCREMENT NOT NULL,
`userId` int NOT NULL,
`clientMatchId` varchar(40) NOT NULL,
`mode` varchar(12) NOT NULL,
`difficulty` varchar(12) NOT NULL,
`perTeam` tinyint NOT NULL,
`result` varchar(8) NOT NULL,
`reason` varchar(16) NOT NULL,
`teamScore` int NOT NULL,
`enemyScore` int NOT NULL,
`kills` int NOT NULL,
`deaths` int NOT NULL,
`captures` int NOT NULL,
`headshots` int NOT NULL,
`damage` int NOT NULL,
`accuracyPm` smallint NOT NULL,
`durationSec` smallint NOT NULL,
`xpGained` int NOT NULL,
`createdAt` timestamp NOT NULL DEFAULT (now()),
CONSTRAINT `match_records_id` PRIMARY KEY(`id`),
CONSTRAINT `match_records_client_unique` UNIQUE(`userId`, `clientMatchId`)
);

CREATE INDEX `match_records_user_time` ON `match_records` (`userId`, `createdAt`);

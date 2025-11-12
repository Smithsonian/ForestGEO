-- Create missing logging tables for upload integrity monitoring
-- These tables are required by the enhanced bulkingestionprocess procedure

-- =============================================================================
-- TABLE 1: uploadmetrics
-- =============================================================================

CREATE TABLE IF NOT EXISTS `uploadmetrics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uploadId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `fileID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `batchID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `schema_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `plotID` int NOT NULL,
  `censusID` int NOT NULL,
  `sourceRecords` int NOT NULL DEFAULT '0' COMMENT 'Number of records in temporarymeasurements before processing',
  `processedRecords` int NOT NULL DEFAULT '0' COMMENT 'Number of records successfully inserted into coremeasurements',
  `failedRecords` int NOT NULL DEFAULT '0' COMMENT 'Number of records that failed validation (in failedmeasurements)',
  `missingRecords` int NOT NULL DEFAULT '0' COMMENT 'Records that disappeared: sourceRecords - (processedRecords + failedRecords)',
  `dataLossDetected` tinyint(1) DEFAULT '0' COMMENT 'TRUE if missingRecords > 0 or < 0 (duplicates)',
  `referentialIntegrityPassed` tinyint(1) DEFAULT NULL COMMENT 'TRUE if all measurements link to valid stems/trees/species',
  `duplicatesDetected` tinyint(1) DEFAULT '0' COMMENT 'TRUE if duplicate measurements found',
  `durationMs` int DEFAULT NULL COMMENT 'Total processing time in milliseconds',
  `attemptsNeeded` int DEFAULT '1' COMMENT 'Number of retry attempts before success',
  `status` enum('pending','processing','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT 'pending',
  `errorMessage` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  `startTime` datetime NOT NULL,
  `endTime` datetime DEFAULT NULL,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uploadId` (`uploadId`),
  KEY `idx_uploadmetrics_fileid` (`fileID`),
  KEY `idx_uploadmetrics_batchid` (`batchID`),
  KEY `idx_uploadmetrics_plotid` (`plotID`),
  KEY `idx_uploadmetrics_censusid` (`censusID`),
  KEY `idx_uploadmetrics_status` (`status`),
  KEY `idx_uploadmetrics_dataloss` (`dataLossDetected`),
  KEY `idx_uploadmetrics_starttime` (`startTime`),
  KEY `idx_uploadmetrics_composite` (`fileID`,`batchID`,`schema_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Tracks upload integrity metrics for measurement ingestion';

SELECT 'uploadmetrics table created/verified' as Status;

-- =============================================================================
-- TABLE 2: uploadintegrityalerts
-- =============================================================================

CREATE TABLE IF NOT EXISTS `uploadintegrityalerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `uploadId` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `severity` enum('info','warning','critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'warning',
  `type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `fileID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `batchID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
  `plotID` int NOT NULL,
  `censusID` int NOT NULL,
  `sourceRecords` int NOT NULL,
  `processedRecords` int NOT NULL,
  `failedRecords` int NOT NULL,
  `missingRecords` int NOT NULL,
  `details` json DEFAULT NULL COMMENT 'Additional context like specific missing record IDs, duplicate counts, etc.',
  `resolved` tinyint(1) DEFAULT '0',
  `resolvedAt` datetime DEFAULT NULL,
  `resolvedBy` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL,
  `resolution` text CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci,
  `createdAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alerts_uploadid` (`uploadId`),
  KEY `idx_alerts_severity` (`severity`),
  KEY `idx_alerts_type` (`type`),
  KEY `idx_alerts_fileid` (`fileID`),
  KEY `idx_alerts_batchid` (`batchID`),
  KEY `idx_alerts_resolved` (`resolved`),
  KEY `idx_alerts_created` (`createdAt`),
  CONSTRAINT `fk_alerts_uploadmetrics` FOREIGN KEY (`uploadId`) REFERENCES `uploadmetrics` (`uploadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Stores critical alerts when data loss or integrity issues are detected';

SELECT 'uploadintegrityalerts table created/verified' as Status;

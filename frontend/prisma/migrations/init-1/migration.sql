-- CreateTable
CREATE TABLE `sites` (
    `SiteID` INTEGER NOT NULL AUTO_INCREMENT,
    `SiteName` VARCHAR(250) NOT NULL,
    `SchemaName` VARCHAR(250) NOT NULL,
    `SQDimX` DECIMAL(10, 2) NULL,
    `SQDimY` DECIMAL(10, 2) NULL,
    `DefaultUOMDBH` VARCHAR(50) NULL DEFAULT 'cm',
    `DefaultUOMHOM` VARCHAR(50) NULL DEFAULT 'm',
    `DoubleDataEntry` BIT(1) NOT NULL DEFAULT b'0',

    PRIMARY KEY (`SiteID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `UserID` INTEGER NOT NULL AUTO_INCREMENT,
    `LastName` VARCHAR(100) NOT NULL,
    `FirstName` VARCHAR(100) NOT NULL,
    `Email` VARCHAR(250) NULL,
    `IsAdmin` BIT(1) NULL DEFAULT b'0',
    `UserStatus` ENUM('global', 'db admin', 'lead technician', 'field crew') NOT NULL DEFAULT 'field crew',

    PRIMARY KEY (`UserID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `usersiterelations` (
    `UserSiteRelationID` INTEGER NOT NULL AUTO_INCREMENT,
    `UserID` INTEGER NOT NULL,
    `SiteID` INTEGER NOT NULL,

    INDEX `SiteID`(`SiteID`),
    UNIQUE INDEX `UserID`(`UserID`, `SiteID`),
    PRIMARY KEY (`UserSiteRelationID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `validationprocedures` (
    `ValidationID` INTEGER NOT NULL AUTO_INCREMENT,
    `ProcedureName` VARCHAR(255) NOT NULL,
    `Description` TEXT NULL,
    `Criteria` VARCHAR(255) NULL,
    `Definition` TEXT NULL,
    `ChangelogDefinition` TEXT NULL,
    `IsEnabled` BIT(1) NOT NULL DEFAULT b'1',

    PRIMARY KEY (`ValidationID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `usersiterelations` ADD CONSTRAINT `usersiterelations_ibfk_1` FOREIGN KEY (`UserID`) REFERENCES `users`(`UserID`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `usersiterelations` ADD CONSTRAINT `usersiterelations_ibfk_2` FOREIGN KEY (`SiteID`) REFERENCES `sites`(`SiteID`) ON DELETE NO ACTION ON UPDATE NO ACTION;


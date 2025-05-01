DROP TRIGGER IF EXISTS `after_insert_cleanup`;
DROP TRIGGER IF EXISTS `after_insert_attributes`;
DROP TRIGGER IF EXISTS `after_update_attributes`;
DROP TRIGGER IF EXISTS `after_delete_attributes`;
DROP TRIGGER IF EXISTS `after_insert_census`;
DROP TRIGGER IF EXISTS `after_update_census`;
DROP TRIGGER IF EXISTS `after_delete_census`;
DROP TRIGGER IF EXISTS `after_insert_cmattributes`;
DROP TRIGGER IF EXISTS `after_update_cmattributes`;
DROP TRIGGER IF EXISTS `after_delete_cmattributes`;
DROP TRIGGER IF EXISTS `after_insert_cmverrors`;
DROP TRIGGER IF EXISTS `after_update_cmverrors`;
DROP TRIGGER IF EXISTS `after_delete_cmverrors`;
DROP TRIGGER IF EXISTS `after_insert_coremeasurements`;
DROP TRIGGER IF EXISTS `after_update_coremeasurements`;
DROP TRIGGER IF EXISTS `after_delete_coremeasurements`;
DROP TRIGGER IF EXISTS `after_insert_family`;
DROP TRIGGER IF EXISTS `after_update_family`;
DROP TRIGGER IF EXISTS `after_delete_family`;
DROP TRIGGER IF EXISTS `after_insert_genus`;
DROP TRIGGER IF EXISTS `after_update_genus`;
DROP TRIGGER IF EXISTS `after_delete_genus`;
DROP TRIGGER IF EXISTS `after_insert_personnel`;
DROP TRIGGER IF EXISTS `after_update_personnel`;
DROP TRIGGER IF EXISTS `after_delete_personnel`;
DROP TRIGGER IF EXISTS `after_insert_plots`;
DROP TRIGGER IF EXISTS `after_update_plots`;
DROP TRIGGER IF EXISTS `after_delete_plots`;
DROP TRIGGER IF EXISTS `after_insert_quadratpersonnel`;
DROP TRIGGER IF EXISTS `after_update_quadratpersonnel`;
DROP TRIGGER IF EXISTS `after_delete_quadratpersonnel`;
DROP TRIGGER IF EXISTS `after_insert_quadrats`;
DROP TRIGGER IF EXISTS `after_update_quadrats`;
DROP TRIGGER IF EXISTS `after_delete_quadrats`;
DROP TRIGGER IF EXISTS `after_insert_reference`;
DROP TRIGGER IF EXISTS `after_update_reference`;
DROP TRIGGER IF EXISTS `after_delete_reference`;
DROP TRIGGER IF EXISTS `after_insert_roles`;
DROP TRIGGER IF EXISTS `after_update_roles`;
DROP TRIGGER IF EXISTS `after_delete_roles`;
DROP TRIGGER IF EXISTS `after_insert_species`;
DROP TRIGGER IF EXISTS `after_update_species`;
DROP TRIGGER IF EXISTS `after_delete_species`;
DROP TRIGGER IF EXISTS `after_insert_specieslimits`;
DROP TRIGGER IF EXISTS `after_update_specieslimits`;
DROP TRIGGER IF EXISTS `after_delete_specieslimits`;
DROP TRIGGER IF EXISTS `after_insert_specimens`;
DROP TRIGGER IF EXISTS `after_update_specimens`;
DROP TRIGGER IF EXISTS `after_delete_specimens`;
DROP TRIGGER IF EXISTS `after_insert_stems`;
DROP TRIGGER IF EXISTS `before_stem_update`;
DROP TRIGGER IF EXISTS `after_update_stems`;
DROP TRIGGER IF EXISTS `after_delete_stems`;
DROP TRIGGER IF EXISTS `after_insert_subquadrats`;
DROP TRIGGER IF EXISTS `after_update_subquadrats`;
DROP TRIGGER IF EXISTS `after_delete_subquadrats`;
DROP TRIGGER IF EXISTS `after_insert_trees`;
DROP TRIGGER IF EXISTS `after_update_trees`;
DROP TRIGGER IF EXISTS `after_delete_trees`;
DROP TRIGGER IF EXISTS `after_insert_validationchangelog`;
DROP TRIGGER IF EXISTS `after_update_validationchangelog`;
DROP TRIGGER IF EXISTS `after_delete_validationchangelog`;
DROP TRIGGER IF EXISTS trg_measurementssummary_coremeasurements_update;
DROP TRIGGER IF EXISTS trg_measurementssummary_quadrats_update;
DROP TRIGGER IF EXISTS trg_measurementssummary_trees_update;
DROP TRIGGER IF EXISTS trg_measurementssummary_stems_update;
DROP TRIGGER IF EXISTS trg_measurementssummary_species_update;
DROP TRIGGER IF EXISTS trg_measurementssummary_attributes_update;

# -- MySQL dump 10.13  Distrib 8.3.0, for macos14.2 (x86_64)
# --
# -- Host: forestgeo-mysqldataserver.mysql.database.azure.com    Database: forestgeo_testing
# -- ------------------------------------------------------
# -- Server version	8.0.40-azure
#
# /*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
# /*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
# /*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
# /*!50503 SET NAMES utf8mb4 */;
# /*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
# /*!40103 SET TIME_ZONE='+00:00' */;
# /*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
# /*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
# /*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
# /*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
#
# --
# -- Temporary view structure for view `alltaxonomiesview`
# --
#
# DROP TABLE IF EXISTS `alltaxonomiesview`;
# /*!50001 DROP VIEW IF EXISTS `alltaxonomiesview`*/;
# SET @saved_cs_client     = @@character_set_client;
# /*!50503 SET character_set_client = utf8mb4 */;
# /*!50001 CREATE VIEW `alltaxonomiesview` AS SELECT
#  1 AS `SpeciesID`,
#  1 AS `FamilyID`,
#  1 AS `GenusID`,
#  1 AS `SpeciesCode`,
#  1 AS `Family`,
#  1 AS `Genus`,
#  1 AS `GenusAuthority`,
#  1 AS `SpeciesName`,
#  1 AS `SubSpeciesName`,
#  1 AS `SpeciesIDLevel`,
#  1 AS `SpeciesAuthority`,
#  1 AS `SubspeciesAuthority`,
#  1 AS `ValidCode`,
#  1 AS `FieldFamily`,
#  1 AS `SpeciesDescription`*/;
# SET character_set_client = @saved_cs_client;
#
# --
# -- Table structure for table `attributes`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_attributes` AFTER INSERT ON `attributes` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT('Code', NEW.Code, 'Description', NEW.Description, 'Status', NEW.Status);
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('attributes', NEW.Code, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_attributes` AFTER UPDATE ON `attributes` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Initialize JSON for the changed fields only
#         IF OLD.Code != NEW.Code THEN
#             SET changes_json = JSON_SET(changes_json, '$.Code', JSON_OBJECT('Old', OLD.Code, 'New', NEW.Code));
#         END IF;
#
#         IF OLD.Description != NEW.Description THEN
#             SET changes_json =
#                     JSON_SET(changes_json, '$.Description',
#                              JSON_OBJECT('Old', OLD.Description, 'New', NEW.Description));
#         END IF;
#
#         IF OLD.Status != NEW.Status THEN
#             SET changes_json = JSON_SET(changes_json, '$.Status', JSON_OBJECT('Old', OLD.Status, 'New', NEW.Status));
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('attributes', NEW.Code, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_attributes` AFTER DELETE ON `attributes` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT('Code', OLD.Code, 'Description', OLD.Description, 'Status', OLD.Status);
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('attributes', OLD.Code, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `census`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_census` AFTER INSERT ON `census` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'CensusID', NEW.CensusID,
#                 'PlotID', NEW.PlotID,
#                 'StartDate', NEW.StartDate,
#                 'EndDate', NEW.EndDate,
#                 'Description', NEW.Description,
#                 'PlotCensusNumber', NEW.PlotCensusNumber
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('census', NEW.CensusID, 'INSERT', new_json, NOW(), 'User', NEW.PlotID, NEW.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_census` AFTER UPDATE ON `census` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.PlotID != NEW.PlotID THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotID', NEW.PlotID);
#         END IF;
#
#         IF OLD.StartDate != NEW.StartDate THEN
#             SET changes_json = JSON_SET(changes_json, '$.StartDate', NEW.StartDate);
#         END IF;
#
#         IF OLD.EndDate != NEW.EndDate THEN
#             SET changes_json = JSON_SET(changes_json, '$.EndDate', NEW.EndDate);
#         END IF;
#
#         IF OLD.Description != NEW.Description THEN
#             SET changes_json = JSON_SET(changes_json, '$.Description', NEW.Description);
#         END IF;
#
#         IF OLD.PlotCensusNumber != NEW.PlotCensusNumber THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotCensusNumber', NEW.PlotCensusNumber);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID,
#                                           CensusID)
#             VALUES ('census', NEW.CensusID, 'UPDATE', changes_json, NOW(), 'User', NEW.PlotID, NEW.CensusID);
#         END IF;
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_census` AFTER DELETE ON `census` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'CensusID', OLD.CensusID,
#                 'PlotID', OLD.PlotID,
#                 'StartDate', OLD.StartDate,
#                 'EndDate', OLD.EndDate,
#                 'Description', OLD.Description,
#                 'PlotCensusNumber', OLD.PlotCensusNumber
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('census', OLD.CensusID, 'DELETE', old_json, NOW(), 'User', OLD.PlotID, OLD.CensusID);
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `censusquadrat`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
#
# --
# -- Table structure for table `cmattributes`
# --
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_cmattributes` AFTER INSERT ON `cmattributes` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'CMAID', NEW.CMAID,
#                 'CoreMeasurementID', NEW.CoreMeasurementID,
#                 'Code', NEW.Code
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('cmattributes', NEW.CMAID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_cmattributes` AFTER UPDATE ON `cmattributes` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.CoreMeasurementID != NEW.CoreMeasurementID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CoreMeasurementID', NEW.CoreMeasurementID);
#         END IF;
#
#         IF OLD.Code != NEW.Code THEN
#             SET changes_json = JSON_SET(changes_json, '$.Code', NEW.Code);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('cmattributes', NEW.CMAID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_cmattributes` AFTER DELETE ON `cmattributes` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'CMAID', OLD.CMAID,
#                 'CoreMeasurementID', OLD.CoreMeasurementID,
#                 'Code', OLD.Code
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('cmattributes', OLD.CMAID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `cmverrors`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_cmverrors` AFTER INSERT ON `cmverrors` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'CMVErrorID', NEW.CMVErrorID,
#                 'CoreMeasurementID', NEW.CoreMeasurementID,
#                 'ValidationErrorID', NEW.ValidationErrorID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('cmverrors', NEW.CMVErrorID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_cmverrors` AFTER UPDATE ON `cmverrors` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.CoreMeasurementID != NEW.CoreMeasurementID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CoreMeasurementID', NEW.CoreMeasurementID);
#         END IF;
#
#         IF OLD.ValidationErrorID != NEW.ValidationErrorID THEN
#             SET changes_json = JSON_SET(changes_json, '$.ValidationErrorID', NEW.ValidationErrorID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('cmverrors', NEW.CMVErrorID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_cmverrors` AFTER DELETE ON `cmverrors` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'CMVErrorID', OLD.CMVErrorID,
#                 'CoreMeasurementID', OLD.CoreMeasurementID,
#                 'ValidationErrorID', OLD.ValidationErrorID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('cmverrors', OLD.CMVErrorID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `coremeasurements`
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_coremeasurements` AFTER INSERT ON `coremeasurements` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     DECLARE plot_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID associated with the StemID's QuadratID
#         SELECT PlotID
#         INTO plot_id
#         FROM quadrats q
#                  JOIN stems s ON q.QuadratID = s.QuadratID
#         WHERE s.StemID = NEW.StemID
#         LIMIT 1;
#
#         SET new_json = JSON_OBJECT(
#                 'CoreMeasurementID', NEW.CoreMeasurementID,
#                 'CensusID', NEW.CensusID,
#                 'StemID', NEW.StemID,
#                 'IsValidated', CAST(NEW.IsValidated AS UNSIGNED),
#                 'MeasurementDate', NEW.MeasurementDate,
#                 'MeasuredDBH', NEW.MeasuredDBH,
#                 'MeasuredHOM', NEW.MeasuredHOM,
#                 'Description', NEW.Description,
#                 'UserDefinedFields', NEW.UserDefinedFields
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('coremeasurements', NEW.CoreMeasurementID, 'INSERT', new_json, NOW(), 'User', plot_id, NEW.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_coremeasurements` AFTER UPDATE ON `coremeasurements` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     DECLARE plot_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID associated with the StemID's QuadratID
#         SELECT PlotID
#         INTO plot_id
#         FROM quadrats q
#                  JOIN stems s ON q.QuadratID = s.QuadratID
#         WHERE s.StemID = NEW.StemID
#         LIMIT 1;
#
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.CensusID != NEW.CensusID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CensusID', NEW.CensusID);
#         END IF;
#
#         IF OLD.StemID != NEW.StemID THEN
#             SET changes_json = JSON_SET(changes_json, '$.StemID', NEW.StemID);
#         END IF;
#
#         IF OLD.IsValidated != NEW.IsValidated THEN
#             SET changes_json = JSON_SET(changes_json, '$.IsValidated', CAST(NEW.IsValidated AS UNSIGNED));
#         END IF;
#
#         IF OLD.MeasurementDate != NEW.MeasurementDate THEN
#             SET changes_json = JSON_SET(changes_json, '$.MeasurementDate', NEW.MeasurementDate);
#         END IF;
#
#         IF OLD.MeasuredDBH != NEW.MeasuredDBH THEN
#             SET changes_json = JSON_SET(changes_json, '$.MeasuredDBH', NEW.MeasuredDBH);
#         END IF;
#
#         IF OLD.MeasuredHOM != NEW.MeasuredHOM THEN
#             SET changes_json = JSON_SET(changes_json, '$.MeasuredHOM', NEW.MeasuredHOM);
#         END IF;
#
#         IF OLD.Description != NEW.Description THEN
#             SET changes_json = JSON_SET(changes_json, '$.Description', NEW.Description);
#         END IF;
#
#         IF OLD.UserDefinedFields != NEW.UserDefinedFields THEN
#             SET changes_json = JSON_SET(changes_json, '$.UserDefinedFields', NEW.UserDefinedFields);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID,
#                                           CensusID)
#             VALUES ('coremeasurements', NEW.CoreMeasurementID, 'UPDATE', changes_json, NOW(), 'User', plot_id,
#                     NEW.CensusID);
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `failedmeasurements`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
#
# --
# -- Table structure for table `family`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_family` AFTER INSERT ON `family` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'FamilyID', NEW.FamilyID,
#                 'Family', NEW.Family,
#                 'ReferenceID', NEW.ReferenceID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('family', NEW.FamilyID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_family` AFTER UPDATE ON `family` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.Family != NEW.Family THEN
#             SET changes_json = JSON_SET(changes_json, '$.Family', NEW.Family);
#         END IF;
#
#         IF OLD.ReferenceID != NEW.ReferenceID THEN
#             SET changes_json = JSON_SET(changes_json, '$.ReferenceID', NEW.ReferenceID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('family', NEW.FamilyID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_family` AFTER DELETE ON `family` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'FamilyID', OLD.FamilyID,
#                 'Family', OLD.Family,
#                 'ReferenceID', OLD.ReferenceID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('family', OLD.FamilyID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `genus`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_genus` AFTER INSERT ON `genus` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'GenusID', NEW.GenusID,
#                 'FamilyID', NEW.FamilyID,
#                 'Genus', NEW.Genus,
#                 'ReferenceID', NEW.ReferenceID,
#                 'GenusAuthority', NEW.GenusAuthority
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('genus', NEW.GenusID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_genus` AFTER UPDATE ON `genus` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.FamilyID != NEW.FamilyID THEN
#             SET changes_json = JSON_SET(changes_json, '$.FamilyID', NEW.FamilyID);
#         END IF;
#
#         IF OLD.Genus != NEW.Genus THEN
#             SET changes_json = JSON_SET(changes_json, '$.Genus', NEW.Genus);
#         END IF;
#
#         IF OLD.ReferenceID != NEW.ReferenceID THEN
#             SET changes_json = JSON_SET(changes_json, '$.ReferenceID', NEW.ReferenceID);
#         END IF;
#
#         IF OLD.GenusAuthority != NEW.GenusAuthority THEN
#             SET changes_json = JSON_SET(changes_json, '$.GenusAuthority', NEW.GenusAuthority);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('genus', NEW.GenusID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_genus` AFTER DELETE ON `genus` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'GenusID', OLD.GenusID,
#                 'FamilyID', OLD.FamilyID,
#                 'Genus', OLD.Genus,
#                 'ReferenceID', OLD.ReferenceID,
#                 'GenusAuthority', OLD.GenusAuthority
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('genus', OLD.GenusID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `measurementssummary`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
#
# --
# -- Table structure for table `personnel`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_personnel` AFTER INSERT ON `personnel` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'PersonnelID', NEW.PersonnelID,
#                 'CensusID', NEW.CensusID,
#                 'FirstName', NEW.FirstName,
#                 'LastName', NEW.LastName,
#                 'RoleID', NEW.RoleID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, CensusID)
#         VALUES ('personnel', NEW.PersonnelID, 'INSERT', new_json, NOW(), 'User', NEW.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_personnel` AFTER UPDATE ON `personnel` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.CensusID != NEW.CensusID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CensusID', NEW.CensusID);
#         END IF;
#
#         IF OLD.FirstName != NEW.FirstName THEN
#             SET changes_json = JSON_SET(changes_json, '$.FirstName', NEW.FirstName);
#         END IF;
#
#         IF OLD.LastName != NEW.LastName THEN
#             SET changes_json = JSON_SET(changes_json, '$.LastName', NEW.LastName);
#         END IF;
#
#         IF OLD.RoleID != NEW.RoleID THEN
#             SET changes_json = JSON_SET(changes_json, '$.RoleID', NEW.RoleID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           CensusID)
#             VALUES ('personnel', NEW.PersonnelID, 'UPDATE', changes_json, NOW(), 'User', NEW.CensusID);
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_personnel` AFTER DELETE ON `personnel` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'PersonnelID', OLD.PersonnelID,
#                 'CensusID', OLD.CensusID,
#                 'FirstName', OLD.FirstName,
#                 'LastName', OLD.LastName,
#                 'RoleID', OLD.RoleID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, CensusID)
#         VALUES ('personnel', OLD.PersonnelID, 'DELETE', old_json, NOW(), 'User', OLD.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `plots`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_plots` AFTER INSERT ON `plots` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'PlotID', NEW.PlotID,
#                 'PlotName', NEW.PlotName,
#                 'LocationName', NEW.LocationName,
#                 'CountryName', NEW.CountryName,
#                 'DimensionX', NEW.DimensionX,
#                 'DimensionY', NEW.DimensionY,
#                 'Area', NEW.Area,
#                 'GlobalX', NEW.GlobalX,
#                 'GlobalY', NEW.GlobalY,
#                 'GlobalZ', NEW.GlobalZ,
#                 'PlotShape', NEW.PlotShape,
#                 'PlotDescription', NEW.PlotDescription,
#                 'DefaultDimensionUnits', NEW.DefaultDimensionUnits,
#                 'DefaultCoordinateUnits', NEW.DefaultCoordinateUnits,
#                 'DefaultAreaUnits', NEW.DefaultAreaUnits,
#                 'DefaultDBHUnits', NEW.DefaultDBHUnits,
#                 'DefaultHOMUnits', NEW.DefaultHOMUnits
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID)
#         VALUES ('plots', NEW.PlotID, 'INSERT', new_json, NOW(), 'User', NEW.PlotID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_plots` AFTER UPDATE ON `plots` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add changed fields to the JSON object
#         IF OLD.PlotName != NEW.PlotName THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotName', NEW.PlotName);
#         END IF;
#
#         IF OLD.LocationName != NEW.LocationName THEN
#             SET changes_json = JSON_SET(changes_json, '$.LocationName', NEW.LocationName);
#         END IF;
#
#         IF OLD.CountryName != NEW.CountryName THEN
#             SET changes_json = JSON_SET(changes_json, '$.CountryName', NEW.CountryName);
#         END IF;
#
#         IF OLD.DimensionX != NEW.DimensionX THEN
#             SET changes_json = JSON_SET(changes_json, '$.DimensionX', NEW.DimensionX);
#         END IF;
#
#         IF OLD.DimensionY != NEW.DimensionY THEN
#             SET changes_json = JSON_SET(changes_json, '$.DimensionY', NEW.DimensionY);
#         END IF;
#
#         IF OLD.Area != NEW.Area THEN
#             SET changes_json = JSON_SET(changes_json, '$.Area', NEW.Area);
#         END IF;
#
#         IF OLD.GlobalX != NEW.GlobalX THEN
#             SET changes_json = JSON_SET(changes_json, '$.GlobalX', NEW.GlobalX);
#         END IF;
#
#         IF OLD.GlobalY != NEW.GlobalY THEN
#             SET changes_json = JSON_SET(changes_json, '$.GlobalY', NEW.GlobalY);
#         END IF;
#
#         IF OLD.GlobalZ != NEW.GlobalZ THEN
#             SET changes_json = JSON_SET(changes_json, '$.GlobalZ', NEW.GlobalZ);
#         END IF;
#
#         IF OLD.PlotShape != NEW.PlotShape THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotShape', NEW.PlotShape);
#         END IF;
#
#         IF OLD.PlotDescription != NEW.PlotDescription THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotDescription', NEW.PlotDescription);
#         END IF;
#
#         IF OLD.DefaultDimensionUnits != NEW.DefaultDimensionUnits THEN
#             SET changes_json = JSON_SET(changes_json, '$.DefaultDimensionUnits', NEW.DefaultDimensionUnits);
#         END IF;
#
#         IF OLD.DefaultCoordinateUnits != NEW.DefaultCoordinateUnits THEN
#             SET changes_json = JSON_SET(changes_json, '$.DefaultCoordinateUnits', NEW.DefaultCoordinateUnits);
#         END IF;
#
#         IF OLD.DefaultAreaUnits != NEW.DefaultAreaUnits THEN
#             SET changes_json = JSON_SET(changes_json, '$.DefaultAreaUnits', NEW.DefaultAreaUnits);
#         END IF;
#
#         IF OLD.DefaultDBHUnits != NEW.DefaultDBHUnits THEN
#             SET changes_json = JSON_SET(changes_json, '$.DefaultDBHUnits', NEW.DefaultDBHUnits);
#         END IF;
#
#         IF OLD.DefaultHOMUnits != NEW.DefaultHOMUnits THEN
#             SET changes_json = JSON_SET(changes_json, '$.DefaultHOMUnits', NEW.DefaultHOMUnits);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID)
#             VALUES ('plots', NEW.PlotID, 'UPDATE', changes_json, NOW(), 'User', NEW.PlotID);
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_plots` AFTER DELETE ON `plots` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'PlotID', OLD.PlotID,
#                 'PlotName', OLD.PlotName,
#                 'LocationName', OLD.LocationName,
#                 'CountryName', OLD.CountryName,
#                 'DimensionX', OLD.DimensionX,
#                 'DimensionY', OLD.DimensionY,
#                 'Area', OLD.Area,
#                 'GlobalX', OLD.GlobalX,
#                 'GlobalY', OLD.GlobalY,
#                 'GlobalZ', OLD.GlobalZ,
#                 'PlotShape', OLD.PlotShape,
#                 'PlotDescription', OLD.PlotDescription,
#                 'DefaultDimensionUnits', OLD.DefaultDimensionUnits,
#                 'DefaultCoordinateUnits', OLD.DefaultCoordinateUnits,
#                 'DefaultAreaUnits', OLD.DefaultAreaUnits,
#                 'DefaultDBHUnits', OLD.DefaultDBHUnits,
#                 'DefaultHOMUnits', OLD.DefaultHOMUnits
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID)
#         VALUES ('plots', OLD.PlotID, 'DELETE', old_json, NOW(), 'User', OLD.PlotID);
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `postvalidationqueries`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
#
# --
# -- Table structure for table `quadratpersonnel`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_quadratpersonnel` AFTER INSERT ON `quadratpersonnel` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     DECLARE plot_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID associated with the QuadratID
#         SELECT PlotID INTO plot_id FROM quadrats WHERE QuadratID = NEW.QuadratID LIMIT 1;
#
#         SET new_json = JSON_OBJECT(
#                 'QuadratPersonnelID', NEW.QuadratPersonnelID,
#                 'QuadratID', NEW.QuadratID,
#                 'PersonnelID', NEW.PersonnelID,
#                 'CensusID', NEW.CensusID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('quadratpersonnel', NEW.QuadratPersonnelID, 'INSERT', new_json, NOW(), 'User', plot_id, NEW.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_quadratpersonnel` AFTER UPDATE ON `quadratpersonnel` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     DECLARE plot_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID associated with the QuadratID
#         SELECT PlotID INTO plot_id FROM quadrats WHERE QuadratID = NEW.QuadratID LIMIT 1;
#
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.QuadratID != NEW.QuadratID THEN
#             SET changes_json = JSON_SET(changes_json, '$.QuadratID', NEW.QuadratID);
#         END IF;
#
#         IF OLD.PersonnelID != NEW.PersonnelID THEN
#             SET changes_json = JSON_SET(changes_json, '$.PersonnelID', NEW.PersonnelID);
#         END IF;
#
#         IF OLD.CensusID != NEW.CensusID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CensusID', NEW.CensusID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID,
#                                           CensusID)
#             VALUES ('quadratpersonnel', NEW.QuadratPersonnelID, 'UPDATE', changes_json, NOW(), 'User', plot_id,
#                     NEW.CensusID);
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_quadratpersonnel` AFTER DELETE ON `quadratpersonnel` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     DECLARE plot_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID associated with the QuadratID
#         SELECT PlotID INTO plot_id FROM quadrats WHERE QuadratID = OLD.QuadratID LIMIT 1;
#
#         SET old_json = JSON_OBJECT(
#                 'QuadratPersonnelID', OLD.QuadratPersonnelID,
#                 'QuadratID', OLD.QuadratID,
#                 'PersonnelID', OLD.PersonnelID,
#                 'CensusID', OLD.CensusID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('quadratpersonnel', OLD.QuadratPersonnelID, 'DELETE', old_json, NOW(), 'User', plot_id, OLD.CensusID);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `quadrats`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_quadrats` AFTER INSERT ON `quadrats` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     DECLARE census_id INT;
#
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SELECT CensusID
#         INTO census_id
#         FROM censusquadrat
#         WHERE QuadratID = NEW.QuadratID
#         LIMIT 1;
#
#         SET new_json = JSON_OBJECT(
#                 'QuadratID', NEW.QuadratID,
#                 'PlotID', NEW.PlotID,
#                 'QuadratName', NEW.QuadratName,
#                 'StartX', NEW.StartX,
#                 'StartY', NEW.StartY,
#                 'DimensionX', NEW.DimensionX,
#                 'DimensionY', NEW.DimensionY,
#                 'Area', NEW.Area,
#                 'QuadratShape', NEW.QuadratShape
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('quadrats', NEW.QuadratID, 'INSERT', new_json, NOW(), 'User', NEW.PlotID, census_id);
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_quadrats` AFTER UPDATE ON `quadrats` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     DECLARE census_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch the CensusID associated with the updated QuadratID
#         SELECT CensusID
#         INTO census_id
#         FROM censusquadrat
#         WHERE QuadratID = NEW.QuadratID
#         LIMIT 1;
#
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.PlotID != NEW.PlotID THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotID', NEW.PlotID);
#         END IF;
#
#         IF OLD.QuadratName != NEW.QuadratName THEN
#             SET changes_json = JSON_SET(changes_json, '$.QuadratName', NEW.QuadratName);
#         END IF;
#
#         IF OLD.StartX != NEW.StartX THEN
#             SET changes_json = JSON_SET(changes_json, '$.StartX', NEW.StartX);
#         END IF;
#
#         IF OLD.StartY != NEW.StartY THEN
#             SET changes_json = JSON_SET(changes_json, '$.StartY', NEW.StartY);
#         END IF;
#
#         IF OLD.DimensionX != NEW.DimensionX THEN
#             SET changes_json = JSON_SET(changes_json, '$.DimensionX', NEW.DimensionX);
#         END IF;
#
#         IF OLD.DimensionY != NEW.DimensionY THEN
#             SET changes_json = JSON_SET(changes_json, '$.DimensionY', NEW.DimensionY);
#         END IF;
#
#         IF OLD.Area != NEW.Area THEN
#             SET changes_json = JSON_SET(changes_json, '$.Area', NEW.Area);
#         END IF;
#
#         IF OLD.QuadratShape != NEW.QuadratShape THEN
#             SET changes_json = JSON_SET(changes_json, '$.QuadratShape', NEW.QuadratShape);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID,
#                                           CensusID)
#             VALUES ('quadrats', NEW.QuadratID, 'UPDATE', changes_json, NOW(), 'User', NEW.PlotID, census_id);
#         END IF;
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_quadrats` AFTER DELETE ON `quadrats` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     DECLARE census_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SELECT CensusID
#         INTO census_id
#         FROM censusquadrat
#         WHERE QuadratID = OLD.QuadratID
#         LIMIT 1;
#
#         SET old_json = JSON_OBJECT(
#                 'QuadratID', OLD.QuadratID,
#                 'PlotID', OLD.PlotID,
#                 'QuadratName', OLD.QuadratName,
#                 'StartX', OLD.StartX,
#                 'StartY', OLD.StartY,
#                 'DimensionX', OLD.DimensionX,
#                 'DimensionY', OLD.DimensionY,
#                 'Area', OLD.Area,
#                 'QuadratShape', OLD.QuadratShape
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('quadrats', OLD.QuadratID, 'DELETE', old_json, NOW(), 'User', OLD.PlotID, census_id);
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `reference`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_reference` AFTER INSERT ON `reference` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'ReferenceID', NEW.ReferenceID,
#                 'PublicationTitle', NEW.PublicationTitle,
#                 'FullReference', NEW.FullReference,
#                 'DateOfPublication', NEW.DateOfPublication,
#                 'Citation', NEW.Citation
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('reference', NEW.ReferenceID, 'INSERT', new_json, NOW(), 'User');
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_reference` AFTER UPDATE ON `reference` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.PublicationTitle != NEW.PublicationTitle THEN
#             SET changes_json = JSON_SET(changes_json, '$.PublicationTitle', NEW.PublicationTitle);
#         END IF;
#
#         IF OLD.FullReference != NEW.FullReference THEN
#             SET changes_json = JSON_SET(changes_json, '$.FullReference', NEW.FullReference);
#         END IF;
#
#         IF OLD.DateOfPublication != NEW.DateOfPublication THEN
#             SET changes_json = JSON_SET(changes_json, '$.DateOfPublication', NEW.DateOfPublication);
#         END IF;
#
#         IF OLD.Citation != NEW.Citation THEN
#             SET changes_json = JSON_SET(changes_json, '$.Citation', NEW.Citation);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('reference', NEW.ReferenceID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
#
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_reference` AFTER DELETE ON `reference` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'ReferenceID', OLD.ReferenceID,
#                 'PublicationTitle', OLD.PublicationTitle,
#                 'FullReference', OLD.FullReference,
#                 'DateOfPublication', OLD.DateOfPublication,
#                 'Citation', OLD.Citation
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('reference', OLD.ReferenceID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `roles`
# --
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_roles` AFTER INSERT ON `roles` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'RoleID', NEW.RoleID,
#                 'RoleName', NEW.RoleName,
#                 'RoleDescription', NEW.RoleDescription
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('roles', NEW.RoleID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_roles` AFTER UPDATE ON `roles` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.RoleName != NEW.RoleName THEN
#             SET changes_json = JSON_SET(changes_json, '$.RoleName', NEW.RoleName);
#         END IF;
#
#         IF OLD.RoleDescription != NEW.RoleDescription THEN
#             SET changes_json = JSON_SET(changes_json, '$.RoleDescription', NEW.RoleDescription);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('roles', NEW.RoleID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_roles` AFTER DELETE ON `roles` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'RoleID', OLD.RoleID,
#                 'RoleName', OLD.RoleName,
#                 'RoleDescription', OLD.RoleDescription
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('roles', OLD.RoleID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `species`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_species` AFTER INSERT ON `species` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'SpeciesID', NEW.SpeciesID,
#                 'GenusID', NEW.GenusID,
#                 'SpeciesCode', NEW.SpeciesCode,
#                 'SpeciesName', NEW.SpeciesName,
#                 'SubspeciesName', NEW.SubspeciesName,
#                 'IDLevel', NEW.IDLevel,
#                 'SpeciesAuthority', NEW.SpeciesAuthority,
#                 'SubspeciesAuthority', NEW.SubspeciesAuthority,
#                 'FieldFamily', NEW.FieldFamily,
#                 'Description', NEW.Description,
#                 'ValidCode', NEW.ValidCode,
#                 'ReferenceID', NEW.ReferenceID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('species', NEW.SpeciesID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_species` AFTER UPDATE ON `species` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.GenusID != NEW.GenusID THEN
#             SET changes_json = JSON_SET(changes_json, '$.GenusID', NEW.GenusID);
#         END IF;
#
#         IF OLD.SpeciesCode != NEW.SpeciesCode THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesCode', NEW.SpeciesCode);
#         END IF;
#
#         IF OLD.SpeciesName != NEW.SpeciesName THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesName', NEW.SpeciesName);
#         END IF;
#
#         IF OLD.SubspeciesName != NEW.SubspeciesName THEN
#             SET changes_json = JSON_SET(changes_json, '$.SubspeciesName', NEW.SubspeciesName);
#         END IF;
#
#         IF OLD.IDLevel != NEW.IDLevel THEN
#             SET changes_json = JSON_SET(changes_json, '$.IDLevel', NEW.IDLevel);
#         END IF;
#
#         IF OLD.SpeciesAuthority != NEW.SpeciesAuthority THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesAuthority', NEW.SpeciesAuthority);
#         END IF;
#
#         IF OLD.SubspeciesAuthority != NEW.SubspeciesAuthority THEN
#             SET changes_json = JSON_SET(changes_json, '$.SubspeciesAuthority', NEW.SubspeciesAuthority);
#         END IF;
#
#         IF OLD.FieldFamily != NEW.FieldFamily THEN
#             SET changes_json = JSON_SET(changes_json, '$.FieldFamily', NEW.FieldFamily);
#         END IF;
#
#         IF OLD.Description != NEW.Description THEN
#             SET changes_json = JSON_SET(changes_json, '$.Description', NEW.Description);
#         END IF;
#
#         IF OLD.ValidCode != NEW.ValidCode THEN
#             SET changes_json = JSON_SET(changes_json, '$.ValidCode', NEW.ValidCode);
#         END IF;
#
#         IF OLD.ReferenceID != NEW.ReferenceID THEN
#             SET changes_json = JSON_SET(changes_json, '$.ReferenceID', NEW.ReferenceID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('species', NEW.SpeciesID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_species` AFTER DELETE ON `species` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'SpeciesID', OLD.SpeciesID,
#                 'GenusID', OLD.GenusID,
#                 'SpeciesCode', OLD.SpeciesCode,
#                 'SpeciesName', OLD.SpeciesName,
#                 'SubspeciesName', OLD.SubspeciesName,
#                 'IDLevel', OLD.IDLevel,
#                 'SpeciesAuthority', OLD.SpeciesAuthority,
#                 'SubspeciesAuthority', OLD.SubspeciesAuthority,
#                 'FieldFamily', OLD.FieldFamily,
#                 'Description', OLD.Description,
#                 'ValidCode', OLD.ValidCode,
#                 'ReferenceID', OLD.ReferenceID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('species', OLD.SpeciesID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `specieslimits`
# --
#
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_specieslimits` AFTER INSERT ON `specieslimits` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'SpeciesLimitID', NEW.SpeciesLimitID,
#                 'SpeciesID', NEW.SpeciesID,
#                 'PlotID', NEW.PlotID,
#                 'CensusID', NEW.CensusID,
#                 'LimitType', NEW.LimitType,
#                 'UpperBound', NEW.UpperBound,
#                 'LowerBound', NEW.LowerBound
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('specieslimits', NEW.SpeciesLimitID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_specieslimits` AFTER UPDATE ON `specieslimits` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.SpeciesID != NEW.SpeciesID THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesID', NEW.SpeciesID);
#         END IF;
#
#         IF OLD.PlotID != NEW.PlotID THEN
#             SET changes_json = JSON_SET(changes_json, '$.PlotID', NEW.PlotID);
#         END IF;
#
#         IF OLD.CensusID != NEW.CensusID THEN
#             SET changes_json = JSON_SET(changes_json, '$.CensusID', NEW.CensusID);
#         END IF;
#
#         IF OLD.LimitType != NEW.LimitType THEN
#             SET changes_json = JSON_SET(changes_json, '$.LimitType', NEW.LimitType);
#         END IF;
#
#         IF OLD.UpperBound != NEW.UpperBound THEN
#             SET changes_json = JSON_SET(changes_json, '$.UpperBound', NEW.UpperBound);
#         END IF;
#
#         IF OLD.LowerBound != NEW.LowerBound THEN
#             SET changes_json = JSON_SET(changes_json, '$.LowerBound', NEW.LowerBound);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('specieslimits', NEW.SpeciesLimitID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_specieslimits` AFTER DELETE ON `specieslimits` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'SpeciesLimitID', OLD.SpeciesLimitID,
#                 'SpeciesID', OLD.SpeciesID,
#                 'PlotID', OLD.PlotID,
#                 'CensusID', OLD.CensusID,
#                 'LimitType', OLD.LimitType,
#                 'UpperBound', OLD.UpperBound,
#                 'LowerBound', OLD.LowerBound
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('specieslimits', OLD.SpeciesLimitID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `specimens`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_specimens` AFTER INSERT ON `specimens` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'SpecimenID', NEW.SpecimenID,
#                 'StemID', NEW.StemID,
#                 'PersonnelID', NEW.PersonnelID,
#                 'SpecimenNumber', NEW.SpecimenNumber,
#                 'SpeciesID', NEW.SpeciesID,
#                 'Herbarium', NEW.Herbarium,
#                 'Voucher', NEW.Voucher,
#                 'CollectionDate', NEW.CollectionDate,
#                 'DeterminedBy', NEW.DeterminedBy,
#                 'Description', NEW.Description
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('specimens', NEW.SpecimenID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_specimens` AFTER UPDATE ON `specimens` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.StemID != NEW.StemID THEN
#             SET changes_json = JSON_SET(changes_json, '$.StemID', NEW.StemID);
#         END IF;
#
#         IF OLD.PersonnelID != NEW.PersonnelID THEN
#             SET changes_json = JSON_SET(changes_json, '$.PersonnelID', NEW.PersonnelID);
#         END IF;
#
#         IF OLD.SpecimenNumber != NEW.SpecimenNumber THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpecimenNumber', NEW.SpecimenNumber);
#         END IF;
#
#         IF OLD.SpeciesID != NEW.SpeciesID THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesID', NEW.SpeciesID);
#         END IF;
#
#         IF OLD.Herbarium != NEW.Herbarium THEN
#             SET changes_json = JSON_SET(changes_json, '$.Herbarium', NEW.Herbarium);
#         END IF;
#
#         IF OLD.Voucher != NEW.Voucher THEN
#             SET changes_json = JSON_SET(changes_json, '$.Voucher', NEW.Voucher);
#         END IF;
#
#         IF OLD.CollectionDate != NEW.CollectionDate THEN
#             SET changes_json = JSON_SET(changes_json, '$.CollectionDate', NEW.CollectionDate);
#         END IF;
#
#         IF OLD.DeterminedBy != NEW.DeterminedBy THEN
#             SET changes_json = JSON_SET(changes_json, '$.DeterminedBy', NEW.DeterminedBy);
#         END IF;
#
#         IF OLD.Description != NEW.Description THEN
#             SET changes_json = JSON_SET(changes_json, '$.Description', NEW.Description);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('specimens', NEW.SpecimenID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_specimens` AFTER DELETE ON `specimens` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'SpecimenID', OLD.SpecimenID,
#                 'StemID', OLD.StemID,
#                 'PersonnelID', OLD.PersonnelID,
#                 'SpecimenNumber', OLD.SpecimenNumber,
#                 'SpeciesID', OLD.SpeciesID,
#                 'Herbarium', OLD.Herbarium,
#                 'Voucher', OLD.Voucher,
#                 'CollectionDate', OLD.CollectionDate,
#                 'DeterminedBy', OLD.DeterminedBy,
#                 'Description', OLD.Description
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('specimens', OLD.SpecimenID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `stems`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_stems` AFTER INSERT ON `stems` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     DECLARE plot_id INT;
#     DECLARE census_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID and CensusID associated with the QuadratID
#         SELECT q.PlotID, c.CensusID
#         INTO plot_id, census_id
#         FROM quadrats q
#                  JOIN censusquadrat cq ON cq.QuadratID = q.QuadratID
#                  JOIN census c ON c.CensusID = cq.CensusID
#         WHERE q.QuadratID = NEW.QuadratID
#         LIMIT 1;
#
#         SET new_json = JSON_OBJECT(
#                 'StemID', NEW.StemID,
#                 'TreeID', NEW.TreeID,
#                 'QuadratID', NEW.QuadratID,
#                 'StemNumber', NEW.StemNumber,
#                 'StemTag', NEW.StemTag,
#                 'LocalX', NEW.LocalX,
#                 'LocalY', NEW.LocalY,
#                 'Moved', NEW.Moved,
#                 'StemDescription', NEW.StemDescription
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('stems', NEW.StemID, 'INSERT', new_json, NOW(), 'User', plot_id, census_id);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `before_stem_update` BEFORE UPDATE ON `stems` FOR EACH ROW BEGIN
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Check if local coordinates are changing
#         IF NEW.LocalX <> OLD.LocalX OR NEW.LocalY <> OLD.LocalY THEN
#             -- Mark the stem as moved
#             SET NEW.Moved = 1;
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_stems` AFTER UPDATE ON `stems` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     DECLARE plot_id INT;
#     DECLARE census_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID and CensusID associated with the QuadratID
#         SELECT q.PlotID, c.CensusID
#         INTO plot_id, census_id
#         FROM quadrats q
#                  JOIN censusquadrat cq ON cq.QuadratID = q.QuadratID
#                  JOIN census c ON c.CensusID = cq.CensusID
#         WHERE q.QuadratID = NEW.QuadratID
#         LIMIT 1;
#
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.TreeID != NEW.TreeID THEN
#             SET changes_json = JSON_SET(changes_json, '$.TreeID', NEW.TreeID);
#         END IF;
#
#         IF OLD.QuadratID != NEW.QuadratID THEN
#             SET changes_json = JSON_SET(changes_json, '$.QuadratID', NEW.QuadratID);
#         END IF;
#
#         IF OLD.StemNumber != NEW.StemNumber THEN
#             SET changes_json = JSON_SET(changes_json, '$.StemNumber', NEW.StemNumber);
#         END IF;
#
#         IF OLD.StemTag != NEW.StemTag THEN
#             SET changes_json = JSON_SET(changes_json, '$.StemTag', NEW.StemTag);
#         END IF;
#
#         IF OLD.LocalX != NEW.LocalX THEN
#             SET changes_json = JSON_SET(changes_json, '$.LocalX', NEW.LocalX);
#         END IF;
#
#         IF OLD.LocalY != NEW.LocalY THEN
#             SET changes_json = JSON_SET(changes_json, '$.LocalY', NEW.LocalY);
#         END IF;
#
#         IF OLD.Moved != NEW.Moved THEN
#             SET changes_json = JSON_SET(changes_json, '$.Moved', NEW.Moved);
#         END IF;
#
#         IF OLD.StemDescription != NEW.StemDescription THEN
#             SET changes_json = JSON_SET(changes_json, '$.StemDescription', NEW.StemDescription);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy,
#                                           PlotID,
#                                           CensusID)
#             VALUES ('stems', NEW.StemID, 'UPDATE', changes_json, NOW(), 'User', plot_id, census_id);
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_stems` AFTER DELETE ON `stems` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     DECLARE plot_id INT;
#     DECLARE census_id INT;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Fetch PlotID and CensusID associated with the QuadratID
#         SELECT q.PlotID, c.CensusID
#         INTO plot_id, census_id
#         FROM quadrats q
#                  JOIN censusquadrat cq ON cq.QuadratID = q.QuadratID
#                  JOIN census c ON c.CensusID = cq.CensusID
#         WHERE q.QuadratID = OLD.QuadratID
#         LIMIT 1;
#
#         SET old_json = JSON_OBJECT(
#                 'StemID', OLD.StemID,
#                 'TreeID', OLD.TreeID,
#                 'QuadratID', OLD.QuadratID,
#                 'StemNumber', OLD.StemNumber,
#                 'StemTag', OLD.StemTag,
#                 'LocalX', OLD.LocalX,
#                 'LocalY', OLD.LocalY,
#                 'Moved', OLD.Moved,
#                 'StemDescription', OLD.StemDescription
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy, PlotID,
#                                       CensusID)
#         VALUES ('stems', OLD.StemID, 'DELETE', old_json, NOW(), 'User', plot_id, census_id);
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
#
# --
# -- Table structure for table `trees`
# --
#
# /*!40101 SET character_set_client = @saved_cs_client */;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_insert_trees` AFTER INSERT ON `trees` FOR EACH ROW BEGIN
#     DECLARE new_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET new_json = JSON_OBJECT(
#                 'TreeID', NEW.TreeID,
#                 'TreeTag', NEW.TreeTag,
#                 'SpeciesID', NEW.SpeciesID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('trees', NEW.TreeID, 'INSERT', new_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_update_trees` AFTER UPDATE ON `trees` FOR EACH ROW BEGIN
#     DECLARE changes_json JSON DEFAULT NULL;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         -- Dynamically add only changed fields to the JSON object
#         IF OLD.TreeTag != NEW.TreeTag THEN
#             SET changes_json = JSON_SET(changes_json, '$.TreeTag', NEW.TreeTag);
#         END IF;
#
#         IF OLD.SpeciesID != NEW.SpeciesID THEN
#             SET changes_json = JSON_SET(changes_json, '$.SpeciesID', NEW.SpeciesID);
#         END IF;
#
#         -- Only insert into changelog if there are changes
#         IF changes_json IS NOT NULL THEN
#             INSERT INTO unifiedchangelog (TableName, RecordID, Operation, NewRowState, ChangeTimestamp, ChangedBy)
#             VALUES ('trees', NEW.TreeID, 'UPDATE', changes_json, NOW(), 'User');
#         END IF;
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;
# /*!50003 SET @saved_cs_client      = @@character_set_client */ ;
# /*!50003 SET @saved_cs_results     = @@character_set_results */ ;
# /*!50003 SET @saved_col_connection = @@collation_connection */ ;
# /*!50003 SET character_set_client  = utf8mb4 */ ;
# /*!50003 SET character_set_results = utf8mb4 */ ;
# /*!50003 SET collation_connection  = utf8mb4_0900_ai_ci */ ;
# /*!50003 SET @saved_sql_mode       = @@sql_mode */ ;
# /*!50003 SET sql_mode              = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO' */ ;
# DELIMITER ;;
# /*!50003 CREATE*/ /*!50017 DEFINER=`azureroot`@`%`*/ /*!50003 TRIGGER `after_delete_trees` AFTER DELETE ON `trees` FOR EACH ROW BEGIN
#     DECLARE old_json JSON;
#     if @disable_triggers is null or @disable_triggers = 0 then
#         SET old_json = JSON_OBJECT(
#                 'TreeID', OLD.TreeID,
#                 'TreeTag', OLD.TreeTag,
#                 'SpeciesID', OLD.SpeciesID
#                        );
#         INSERT INTO unifiedchangelog (TableName, RecordID, Operation, OldRowState, ChangeTimestamp, ChangedBy)
#         VALUES ('trees', OLD.TreeID, 'DELETE', old_json, NOW(), 'User');
#     end if;
# END */;;
# DELIMITER ;
# /*!50003 SET sql_mode              = @saved_sql_mode */ ;
# /*!50003 SET character_set_client  = @saved_cs_client */ ;
# /*!50003 SET character_set_results = @saved_cs_results */ ;
# /*!50003 SET collation_connection  = @saved_col_connection */ ;

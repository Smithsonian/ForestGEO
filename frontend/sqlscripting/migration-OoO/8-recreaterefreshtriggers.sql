-- DEPRECATED. Skip this step.

-- Create triggers for coremeasurements
CREATE TRIGGER trg_coremeasurements_set_refresh_needed_after_insert
    AFTER INSERT
    ON coremeasurements
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_coremeasurements_set_refresh_needed_after_update
    AFTER UPDATE
    ON coremeasurements
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_coremeasurements_set_refresh_needed_after_delete
    AFTER DELETE
    ON coremeasurements
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for stems
CREATE TRIGGER trg_stems_set_refresh_needed_after_insert
    AFTER INSERT
    ON stems
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_stems_set_refresh_needed_after_update
    AFTER UPDATE
    ON stems
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_stems_set_refresh_needed_after_delete
    AFTER DELETE
    ON stems
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for trees
CREATE TRIGGER trg_trees_set_refresh_needed_after_insert
    AFTER INSERT
    ON trees
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_trees_set_refresh_needed_after_update
    AFTER UPDATE
    ON trees
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_trees_set_refresh_needed_after_delete
    AFTER DELETE
    ON trees
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for species
CREATE TRIGGER trg_species_set_refresh_needed_after_insert
    AFTER INSERT
    ON species
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_species_set_refresh_needed_after_update
    AFTER UPDATE
    ON species
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_species_set_refresh_needed_after_delete
    AFTER DELETE
    ON species
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for quadrats
CREATE TRIGGER trg_quadrats_set_refresh_needed_after_insert
    AFTER INSERT
    ON quadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_quadrats_set_refresh_needed_after_update
    AFTER UPDATE
    ON quadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_quadrats_set_refresh_needed_after_delete
    AFTER DELETE
    ON quadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for census
CREATE TRIGGER trg_census_set_refresh_needed_after_insert
    AFTER INSERT
    ON census
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_census_set_refresh_needed_after_update
    AFTER UPDATE
    ON census
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_census_set_refresh_needed_after_delete
    AFTER DELETE
    ON census
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for cmattributes
CREATE TRIGGER trg_cmattributes_set_refresh_needed_after_insert
    AFTER INSERT
    ON cmattributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_cmattributes_set_refresh_needed_after_update
    AFTER UPDATE
    ON cmattributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_cmattributes_set_refresh_needed_after_delete
    AFTER DELETE
    ON cmattributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for plots
CREATE TRIGGER trg_plots_set_refresh_needed_after_insert
    AFTER INSERT
    ON plots
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_plots_set_refresh_needed_after_update
    AFTER UPDATE
    ON plots
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_plots_set_refresh_needed_after_delete
    AFTER DELETE
    ON plots
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for subquadrats
CREATE TRIGGER trg_subquadrats_set_refresh_needed_after_insert
    AFTER INSERT
    ON subquadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_subquadrats_set_refresh_needed_after_update
    AFTER UPDATE
    ON subquadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_subquadrats_set_refresh_needed_after_delete
    AFTER DELETE
    ON subquadrats
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for roles
CREATE TRIGGER trg_roles_set_refresh_needed_after_insert
    AFTER INSERT
    ON roles
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_roles_set_refresh_needed_after_update
    AFTER UPDATE
    ON roles
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_roles_set_refresh_needed_after_delete
    AFTER DELETE
    ON roles
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for attributes
CREATE TRIGGER trg_attributes_set_refresh_needed_after_insert
    AFTER INSERT
    ON attributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_attributes_set_refresh_needed_after_update
    AFTER UPDATE
    ON attributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_attributes_set_refresh_needed_after_delete
    AFTER DELETE
    ON attributes
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for genus
CREATE TRIGGER trg_genus_set_refresh_needed_after_insert
    AFTER INSERT
    ON genus
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_genus_set_refresh_needed_after_update
    AFTER UPDATE
    ON genus
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_genus_set_refresh_needed_after_delete
    AFTER DELETE
    ON genus
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for family
CREATE TRIGGER trg_family_set_refresh_needed_after_insert
    AFTER INSERT
    ON family
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_family_set_refresh_needed_after_update
    AFTER UPDATE
    ON family
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_family_set_refresh_needed_after_delete
    AFTER DELETE
    ON family
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for specieslimits
CREATE TRIGGER trg_specieslimits_set_refresh_needed_after_insert
    AFTER INSERT
    ON specieslimits
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_specieslimits_set_refresh_needed_after_update
    AFTER UPDATE
    ON specieslimits
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_specieslimits_set_refresh_needed_after_delete
    AFTER DELETE
    ON specieslimits
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for quadratpersonnel
CREATE TRIGGER trg_quadratpersonnel_set_refresh_needed_after_insert
    AFTER INSERT
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_quadratpersonnel_set_refresh_needed_after_update
    AFTER UPDATE
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_quadratpersonnel_set_refresh_needed_after_delete
    AFTER DELETE
    ON quadratpersonnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

-- Create triggers for personnel
CREATE TRIGGER trg_personnel_set_refresh_needed_after_insert
    AFTER INSERT
    ON personnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_personnel_set_refresh_needed_after_update
    AFTER UPDATE
    ON personnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

CREATE TRIGGER trg_personnel_set_refresh_needed_after_delete
    AFTER DELETE
    ON personnel
    FOR EACH ROW
BEGIN
    UPDATE batchprocessingflag SET needs_refresh = TRUE WHERE flag_status = 'STARTED';
END;

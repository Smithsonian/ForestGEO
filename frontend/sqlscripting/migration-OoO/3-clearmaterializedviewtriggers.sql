-- DEPRECATED. Skip this step

-- Drop triggers for coremeasurements
DROP TRIGGER IF EXISTS trg_coremeasurements_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_coremeasurements_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_coremeasurements_set_refresh_needed_after_delete;

-- Drop triggers for stems
DROP TRIGGER IF EXISTS trg_stems_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_stems_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_stems_set_refresh_needed_after_delete;

-- Drop triggers for trees
DROP TRIGGER IF EXISTS trg_trees_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_trees_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_trees_set_refresh_needed_after_delete;

-- Drop triggers for species
DROP TRIGGER IF EXISTS trg_species_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_species_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_species_set_refresh_needed_after_delete;

-- Drop triggers for quadrats
DROP TRIGGER IF EXISTS trg_quadrats_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_quadrats_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_quadrats_set_refresh_needed_after_delete;

-- Drop triggers for census
DROP TRIGGER IF EXISTS trg_census_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_census_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_census_set_refresh_needed_after_delete;

-- Drop triggers for cmattributes
DROP TRIGGER IF EXISTS trg_cmattributes_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_cmattributes_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_cmattributes_set_refresh_needed_after_delete;

-- Drop triggers for plots
DROP TRIGGER IF EXISTS trg_plots_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_plots_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_plots_set_refresh_needed_after_delete;

-- Drop triggers for subquadrats
DROP TRIGGER IF EXISTS trg_subquadrats_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_subquadrats_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_subquadrats_set_refresh_needed_after_delete;

-- Drop triggers for roles
DROP TRIGGER IF EXISTS trg_roles_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_roles_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_roles_set_refresh_needed_after_delete;

-- Drop triggers for attributes
DROP TRIGGER IF EXISTS trg_attributes_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_attributes_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_attributes_set_refresh_needed_after_delete;

-- Drop triggers for genus
DROP TRIGGER IF EXISTS trg_genus_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_genus_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_genus_set_refresh_needed_after_delete;

-- Drop triggers for family
DROP TRIGGER IF EXISTS trg_family_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_family_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_family_set_refresh_needed_after_delete;

-- Drop triggers for specieslimits
DROP TRIGGER IF EXISTS trg_specieslimits_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_specieslimits_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_specieslimits_set_refresh_needed_after_delete;

-- Drop triggers for quadratpersonnel
DROP TRIGGER IF EXISTS trg_quadratpersonnel_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_quadratpersonnel_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_quadratpersonnel_set_refresh_needed_after_delete;

-- Drop triggers for personnel
DROP TRIGGER IF EXISTS trg_personnel_set_refresh_needed_after_insert;
DROP TRIGGER IF EXISTS trg_personnel_set_refresh_needed_after_update;
DROP TRIGGER IF EXISTS trg_personnel_set_refresh_needed_after_delete;

-- Drop triggers for batchprocessingflag
DROP TRIGGER IF EXISTS trg_batchprocessingflag_before_insert;
DROP TRIGGER IF EXISTS trg_batchprocessingflag_after_update;

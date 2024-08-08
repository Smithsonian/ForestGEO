#
attributes
DROP TRIGGER IF EXISTS after_insert_attributes;
DROP TRIGGER IF EXISTS after_update_attributes;
DROP TRIGGER IF EXISTS after_delete_attributes;

#
census
DROP TRIGGER IF EXISTS after_insert_census;
DROP TRIGGER IF EXISTS after_update_census;
DROP TRIGGER IF EXISTS after_delete_census;

#
cmattributes
DROP TRIGGER IF EXISTS after_insert_cmattributes;
DROP TRIGGER IF EXISTS after_update_cmattributes;
DROP TRIGGER IF EXISTS after_delete_cmattributes;

#
cmverrors
DROP TRIGGER IF EXISTS after_insert_cmverrors;
DROP TRIGGER IF EXISTS after_update_cmverrors;
DROP TRIGGER IF EXISTS after_delete_cmverrors;

#
coremeasurements
DROP TRIGGER IF EXISTS after_insert_coremeasurements;
DROP TRIGGER IF EXISTS after_update_coremeasurements;
DROP TRIGGER IF EXISTS after_delete_coremeasurements;

#
family
DROP TRIGGER IF EXISTS after_insert_family;
DROP TRIGGER IF EXISTS after_update_family;
DROP TRIGGER IF EXISTS after_delete_family;

#
genus
DROP TRIGGER IF EXISTS after_insert_genus;
DROP TRIGGER IF EXISTS after_update_genus;
DROP TRIGGER IF EXISTS after_delete_genus;

#
personnel
DROP TRIGGER IF EXISTS after_insert_personnel;
DROP TRIGGER IF EXISTS after_update_personnel;
DROP TRIGGER IF EXISTS after_delete_personnel;

#
plots
DROP TRIGGER IF EXISTS after_insert_plots;
DROP TRIGGER IF EXISTS after_update_plots;
DROP TRIGGER IF EXISTS after_delete_plots;

#
quadratpersonnel
DROP TRIGGER IF EXISTS after_insert_quadratpersonnel;
DROP TRIGGER IF EXISTS after_update_quadratpersonnel;
DROP TRIGGER IF EXISTS after_delete_quadratpersonnel;

#
quadrats
DROP TRIGGER IF EXISTS after_insert_quadrats;
DROP TRIGGER IF EXISTS after_update_quadrats;
DROP TRIGGER IF EXISTS after_delete_quadrats;

#
reference
DROP TRIGGER IF EXISTS after_insert_reference;
DROP TRIGGER IF EXISTS after_update_reference;
DROP TRIGGER IF EXISTS after_delete_reference;

#
roles
DROP TRIGGER IF EXISTS after_insert_roles;
DROP TRIGGER IF EXISTS after_update_roles;
DROP TRIGGER IF EXISTS after_delete_roles;

#
species
DROP TRIGGER IF EXISTS after_insert_species;
DROP TRIGGER IF EXISTS after_update_species;
DROP TRIGGER IF EXISTS after_delete_species;

#
specieslimits
DROP TRIGGER IF EXISTS after_insert_specieslimits;
DROP TRIGGER IF EXISTS after_update_specieslimits;
DROP TRIGGER IF EXISTS after_delete_specieslimits;

#
specimens
DROP TRIGGER IF EXISTS after_insert_specimens;
DROP TRIGGER IF EXISTS after_update_specimens;
DROP TRIGGER IF EXISTS after_delete_specimens;

#
stems
DROP TRIGGER IF EXISTS after_insert_stems;
DROP TRIGGER IF EXISTS after_update_stems;
DROP TRIGGER IF EXISTS after_delete_stems;

#
subquadrats
DROP TRIGGER IF EXISTS after_insert_subquadrats;
DROP TRIGGER IF EXISTS after_update_subquadrats;
DROP TRIGGER IF EXISTS after_delete_subquadrats;

#
trees
DROP TRIGGER IF EXISTS after_insert_trees;
DROP TRIGGER IF EXISTS after_update_trees;
DROP TRIGGER IF EXISTS after_delete_trees;

#
validationchangelog
DROP TRIGGER IF EXISTS after_insert_validationchangelog;
DROP TRIGGER IF EXISTS after_update_validationchangelog;
DROP TRIGGER IF EXISTS after_delete_validationchangelog;

#
materialized view triggers: measurementssummaryview
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_stems_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_stems_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_stems_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_trees_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_trees_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_trees_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_species_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_species_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_species_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_measurementssummary_after_delete;
DROP TRIGGER IF EXISTS trg_census_refresh_measurementssummary_after_insert;
DROP TRIGGER IF EXISTS trg_census_refresh_measurementssummary_after_update;
DROP TRIGGER IF EXISTS trg_census_refresh_measurementssummary_after_delete;

#
materialized view triggers: viewfulltable
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_coremeasurements_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_cmattributes_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_stems_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_stems_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_stems_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_trees_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_trees_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_trees_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_species_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_species_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_species_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_quadrats_refresh_viewfulltable_after_delete;
DROP TRIGGER IF EXISTS trg_census_refresh_viewfulltable_after_insert;
DROP TRIGGER IF EXISTS trg_census_refresh_viewfulltable_after_update;
DROP TRIGGER IF EXISTS trg_census_refresh_viewfulltable_after_delete;
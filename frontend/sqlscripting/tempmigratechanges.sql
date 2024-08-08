ALTER TABLE quadrats
    ADD CONSTRAINT unique_quadrat_name_per_census_plot
        UNIQUE (CensusID, PlotID, QuadratName);
ALTER TABLE personnel
    ADD CONSTRAINT unique_full_name_per_census
        UNIQUE (CensusID, FirstName, LastName);
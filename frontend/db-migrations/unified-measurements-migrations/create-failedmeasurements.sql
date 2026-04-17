-- Create failedmeasurements table for schemas that were created after
-- the table definition was removed from tablestructures.sql but while
-- the application code still references it.

CREATE TABLE IF NOT EXISTS failedmeasurements
(
    FailedMeasurementID    int auto_increment primary key,
    FileID                 varchar(255)   null,
    BatchID                varchar(36)    null,
    PlotID                 int            null,
    CensusID               int            null,
    Tag                    varchar(20)    null,
    StemTag                varchar(10)    null,
    SpCode                 varchar(25)    null,
    Quadrat                varchar(255)   null,
    X                      decimal(12, 6) null,
    Y                      decimal(12, 6) null,
    DBH                    decimal(12, 6) null,
    HOM                    decimal(12, 6) null,
    Date                   date           null,
    Codes                  varchar(255)   null,
    Comments               varchar(255)   null,
    FailureReasons         text           null,
    OriginalFailureReasons text           null,
    CurrentFailureReasons  text           null,
    LastValidatedAt        datetime       null
);

CREATE INDEX idx_upload_session ON failedmeasurements (FileID, BatchID);
CREATE INDEX idx_plot_census_upload ON failedmeasurements (PlotID, CensusID, FileID, BatchID);

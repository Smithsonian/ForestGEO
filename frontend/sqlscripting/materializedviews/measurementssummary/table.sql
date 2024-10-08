CREATE TABLE IF NOT EXISTS measurementssummary
(
    CoreMeasurementID
    INT
    PRIMARY
    KEY,
    StemID
    INT,
    TreeID
    INT,
    SpeciesID
    INT,
    QuadratID
    INT,
    PlotID
    INT,
    CensusID
    INT,
    SpeciesName
    VARCHAR
(
    64
),
    SubspeciesName VARCHAR
(
    64
),
    SpeciesCode VARCHAR
(
    25
),
    TreeTag VARCHAR
(
    10
),
    StemTag VARCHAR
(
    10
),
    StemLocalX DECIMAL
(
    10,
    6
),
    StemLocalY DECIMAL
(
    10,
    6
),
    StemUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    QuadratName VARCHAR
(
    255
),
    MeasurementDate DATE,
    MeasuredDBH DECIMAL
(
    10,
    6
),
    DBHUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'cm',
    MeasuredHOM DECIMAL
(
    10,
    6
),
    HOMUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    IsValidated BIT DEFAULT b'0',
    Description VARCHAR
(
    255
),
    Attributes VARCHAR
(
    255
)
    );
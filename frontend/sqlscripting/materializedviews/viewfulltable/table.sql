CREATE TABLE IF NOT EXISTS viewfulltable
(
    CoreMeasurementID
    INT
    PRIMARY
    KEY,
    MeasurementDate
    DATE,
    MeasuredDBH
    DECIMAL
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
    Description VARCHAR
(
    255
),
    IsValidated BIT DEFAULT b'0',
    PlotID INT,
    PlotName VARCHAR
(
    255
),
    LocationName VARCHAR
(
    255
),
    CountryName VARCHAR
(
    255
),
    DimensionX INT,
    DimensionY INT,
    PlotDimensionUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    PlotArea DECIMAL
(
    10,
    6
),
    PlotAreaUnits ENUM
(
    'km2',
    'hm2',
    'dam2',
    'm2',
    'dm2',
    'cm2',
    'mm2'
) DEFAULT 'm2',
    PlotGlobalX DECIMAL
(
    10,
    6
),
    PlotGlobalY DECIMAL
(
    10,
    6
),
    PlotGlobalZ DECIMAL
(
    10,
    6
),
    PlotCoordinateUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    PlotShape VARCHAR
(
    255
),
    PlotDescription VARCHAR
(
    255
),
    CensusID INT,
    CensusStartDate DATE,
    CensusEndDate DATE,
    CensusDescription VARCHAR
(
    255
),
    PlotCensusNumber INT,
    QuadratID INT,
    QuadratName VARCHAR
(
    255
),
    QuadratDimensionX INT,
    QuadratDimensionY INT,
    QuadratDimensionUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    QuadratArea DECIMAL
(
    10,
    6
),
    QuadratAreaUnits ENUM
(
    'km2',
    'hm2',
    'dam2',
    'm2',
    'dm2',
    'cm2',
    'mm2'
) DEFAULT 'm2',
    QuadratStartX DECIMAL
(
    10,
    6
),
    QuadratStartY DECIMAL
(
    10,
    6
),
    QuadratCoordinateUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    QuadratShape VARCHAR
(
    255
),
    SubquadratID INT,
    SubquadratName VARCHAR
(
    255
),
    SubquadratDimensionX INT,
    SubquadratDimensionY INT,
    SubquadratDimensionUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    SubquadratX INT,
    SubquadratY INT,
    SubquadratCoordinateUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    TreeID INT,
    TreeTag VARCHAR
(
    10
),
    StemID INT,
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
    StemCoordinateUnits ENUM
(
    'km',
    'hm',
    'dam',
    'm',
    'dm',
    'cm',
    'mm'
) DEFAULT 'm',
    PersonnelID INT,
    FirstName VARCHAR
(
    50
),
    LastName VARCHAR
(
    50
),
    PersonnelRoles VARCHAR
(
    255
),
    SpeciesID INT,
    SpeciesCode VARCHAR
(
    25
),
    SpeciesName VARCHAR
(
    64
),
    SubspeciesName VARCHAR
(
    64
),
    SubspeciesAuthority VARCHAR
(
    128
),
    SpeciesIDLevel VARCHAR
(
    20
),
    GenusID INT,
    Genus VARCHAR
(
    32
),
    GenusAuthority VARCHAR
(
    32
),
    FamilyID INT,
    Family VARCHAR
(
    32
),
    AttributeCode VARCHAR
(
    10
),
    AttributeDescription VARCHAR
(
    255
),
    AttributeStatus ENUM
(
    'alive',
    'alive-not measured',
    'dead',
    'stem dead',
    'broken below',
    'omitted',
    'missing'
) DEFAULT 'alive'
    );

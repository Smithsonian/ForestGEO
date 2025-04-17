alter table temporarymeasurements modify TreeTag varchar(20) null;
alter table trees modify TreeTag varchar(20) null;
alter table viewfulltable modify TreeTag varchar(20) null;
alter table measurementssummary modify TreeTag varchar(20) null;
alter table failedmeasurements modify Tag varchar(20) null;


# alter table coremeasurements modify MeasuredDBH decimal(12, 6) null;
# alter table coremeasurements modify MeasuredHOM decimal(12, 6) null;
#
# alter table failedmeasurements modify X decimal(12, 6) null;
# alter table failedmeasurements modify Y decimal(12, 6) null;
# alter table failedmeasurements modify DBH decimal(12, 6) null;
# alter table failedmeasurements modify HOM decimal(12, 6) null;
#
# alter table measurementssummary modify StemLocalX decimal(12, 6) null;
# alter table measurementssummary modify StemLocalY decimal(12, 6) null;
# alter table measurementssummary modify MeasuredDBH decimal(12, 6) null;
# alter table measurementssummary modify MeasuredHOM decimal(12, 6) null;
#
# alter table plots modify GlobalX decimal(12, 6) null;
# alter table plots modify GlobalY decimal(12, 6) null;
# alter table plots modify GlobalZ decimal(12, 6) null;
# alter table plots modify DimensionX decimal(12, 6) null;
# alter table plots modify DimensionY decimal(12, 6) null;
# alter table plots modify Area decimal(12, 6) null;
#
# alter table quadrats modify StartX decimal(12, 6) null;
# alter table quadrats modify StartY decimal(12, 6) null;
# alter table quadrats modify Area decimal(12, 6) null;
#
# alter table stems modify LocalX decimal(12, 6) null;
# alter table stems modify LocalY decimal(12, 6) null;
#
# alter table temporarymeasurements modify LocalX decimal(12, 6) null;
# alter table temporarymeasurements modify LocalY decimal(12, 6) null;
# alter table temporarymeasurements modify DBH decimal(12, 6) null;
# alter table temporarymeasurements modify HOM decimal(12, 6) null;
#
# alter table specieslimits modify LowerBound decimal(12, 6) null;
# alter table specieslimits modify UpperBound decimal(12, 6) null;

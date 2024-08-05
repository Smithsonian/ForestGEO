// plot custom data type
import { ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';

export type PlotRDS = {
  id?: number;
  plotID?: number;
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  dimensionUnits?: string;
  area?: number;
  areaUnits?: string;
  globalX?: number;
  globalY?: number;
  globalZ?: number;
  coordinateUnits?: string;
  plotShape?: string;
  plotDescription?: string;
  numQuadrats?: number;
  usesSubquadrats?: boolean;
};

export type Plot = PlotRDS | undefined;

export type PlotsResult = ResultType<PlotRDS>;

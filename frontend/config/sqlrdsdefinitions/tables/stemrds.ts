// stem custom data type
import { ResultType } from "@/config/utils";
import {IDataMapper} from "../../datamapper";
import {bitToBoolean, booleanToBit, unitSelectionOptions} from '../../macros';

export type StemRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  quadratID?: number;
  stemNumber?: number;
  stemTag?: string;
  localX?: number;
  localY?: number;
  coordinateUnits?: string;
  moved?: boolean;
  stemDescription?: string;
};

export type StemResult = ResultType<StemRDS>;



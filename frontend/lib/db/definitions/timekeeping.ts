import { ResultType } from '@/config/utils';
import MapperFactory, { IDataMapper } from '@/config/datamapper';
import { bitToBoolean } from '@/config/macros/bitconversion';

// Types and constants
export type CensusRDS =
  | {
      id?: number;
      censusID?: number;
      plotID?: number;
      plotCensusNumber?: number;
      startDate?: Date;
      endDate?: Date;
      description?: string;
      // mysql2 returns TINYINT(1) as a number; GenericMapper turns 0 into undefined.
      isActive?: number | boolean;
    }
  | undefined;
export type CensusResult = ResultType<CensusRDS>;

export interface CensusDateRange {
  censusID: number;
  startDate?: Date;
  endDate?: Date;
}

export interface OrgCensusRDS {
  plotID: number;
  plotCensusNumber: number;
  censusIDs: number[];
  dateRanges: CensusDateRange[];
  description: string;
  isActive: boolean;
}

export type OrgCensus = OrgCensusRDS | undefined;

// Mapper class
export class OrgCensusToCensusResultMapper {
  private censusMapper: IDataMapper<CensusRDS, CensusResult>;

  constructor() {
    this.censusMapper = MapperFactory.getMapper('census');
  }

  demapData(censusResultList: CensusResult[]): OrgCensusRDS[] {
    const censusRDSList = this.censusMapper.mapData(censusResultList);
    const uniqueCensusMap = new Map<number, OrgCensusRDS>();

    censusRDSList.forEach(censusRDS => {
      if (!censusRDS) throw new Error('censusRDS is undefined');

      const { plotCensusNumber, censusID, startDate, endDate, description, isActive } = censusRDS;
      let existingCensus = uniqueCensusMap.get(plotCensusNumber!);

      if (!existingCensus) {
        existingCensus = {
          plotID: censusRDS.plotID!,
          plotCensusNumber: plotCensusNumber!,
          censusIDs: [censusID!],
          dateRanges: [{ censusID: censusID!, startDate, endDate }],
          description: description || '',
          isActive: bitToBoolean(isActive)
        };
        uniqueCensusMap.set(plotCensusNumber!, existingCensus);
      } else {
        existingCensus.censusIDs.push(censusID!);
        existingCensus.dateRanges.push({ censusID: censusID!, startDate, endDate });
        existingCensus.dateRanges.sort((a, b) => b.censusID - a.censusID);
        existingCensus.isActive = existingCensus.isActive || bitToBoolean(isActive);
      }
    });

    return Array.from(uniqueCensusMap.values()).sort((a, b) => b.plotCensusNumber - a.plotCensusNumber);
  }

  async startNewCensus(
    schema: string,
    plotID: number,
    plotCensusNumber: number,
    details?: { description?: string; startDate?: string; endDate?: string }
  ): Promise<number | undefined> {
    // census.StartDate / EndDate are MySQL DATE columns. Keep the browser's date-only
    // values intact so the insert survives strict sql_mode without a Date/timezone
    // round-trip that could change the selected calendar day.
    const newRow = {
      censusID: 0, // This will be replaced with the actual ID after the POST request
      plotID,
      plotCensusNumber,
      startDate: details?.startDate,
      endDate: details?.endDate,
      description: details?.description
    };

    const response = await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newRow })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Census creation failed (HTTP ${response.status}): ${errorBody}`);
    }

    const responseJSON = await response.json();
    return responseJSON.createdIDs?.census;
  }
}

export function reconcileCurrentCensusSelection(currentCensus: OrgCensus, censusList: OrgCensusRDS[]): OrgCensusRDS | undefined {
  if (!currentCensus) return undefined;

  const persistedCensusID = currentCensus.dateRanges?.[0]?.censusID;
  if (persistedCensusID) {
    const exactMatch = censusList.find(census => census.dateRanges?.some(dateRange => dateRange.censusID === persistedCensusID));
    if (exactMatch) return exactMatch;
  }

  return censusList.find(census => census.plotCensusNumber === currentCensus.plotCensusNumber);
}

// Helper function
export async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]): Promise<OrgCensusRDS[]> {
  const orgCensusMapper = new OrgCensusToCensusResultMapper();

  const censusResultList: CensusResult[] = MapperFactory.getMapper<CensusRDS, CensusResult>('census').demapData(
    censusRDSLoad.filter(data => data !== undefined)
  );
  return orgCensusMapper.demapData(censusResultList);
}

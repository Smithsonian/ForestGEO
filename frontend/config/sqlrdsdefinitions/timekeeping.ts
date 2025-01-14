import { ResultType } from '@/config/utils';
import MapperFactory, { IDataMapper } from '@/config/datamapper';

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

      const { plotCensusNumber, censusID, startDate, endDate, description } = censusRDS;
      let existingCensus = uniqueCensusMap.get(plotCensusNumber!);

      if (!existingCensus) {
        existingCensus = {
          plotID: censusRDS.plotID!,
          plotCensusNumber: plotCensusNumber!,
          censusIDs: [censusID!],
          dateRanges: [{ censusID: censusID!, startDate, endDate }],
          description: description || ''
        };
        uniqueCensusMap.set(plotCensusNumber!, existingCensus);
      } else {
        existingCensus.censusIDs.push(censusID!);
        existingCensus.dateRanges.push({ censusID: censusID!, startDate, endDate });
        existingCensus.dateRanges.sort((a, b) => b.censusID - a.censusID);
      }
    });

    return Array.from(uniqueCensusMap.values()).sort((a, b) => b.plotCensusNumber - a.plotCensusNumber);
  }

  async startNewCensus(schema: string, plotID: number, plotCensusNumber: number, description?: string): Promise<number | undefined> {
    const newCensusRDS: CensusRDS = {
      censusID: 0, // This will be replaced with the actual ID after the POST request
      plotID,
      plotCensusNumber,
      startDate: undefined,
      endDate: undefined,
      description
    };

    const response = await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newRow: newCensusRDS })
    });

    const responseJSON = await response.json();
    return responseJSON.createdIDs.census;
  }
}

// Helper function
export async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]): Promise<OrgCensusRDS[]> {
  const orgCensusMapper = new OrgCensusToCensusResultMapper();

  const censusResultList: CensusResult[] = MapperFactory.getMapper<CensusRDS, CensusResult>('census').demapData(
    censusRDSLoad.filter(data => data !== undefined)
  );
  return orgCensusMapper.demapData(censusResultList);
}

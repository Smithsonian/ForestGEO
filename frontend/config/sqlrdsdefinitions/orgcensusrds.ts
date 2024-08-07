import MapperFactory, { IDataMapper } from '../datamapper';
import { GridSelections } from '../macros';
import { CensusRDS, CensusResult } from './tables/censusrds';

interface CensusDateRange {
  censusID: number;
  startDate: Date | undefined;
  endDate: Date | undefined;
}

interface OrgCensusRDS {
  plotID: number;
  plotCensusNumber: number;
  censusIDs: number[];
  dateRanges: CensusDateRange[];
  description: string;
}

export type OrgCensus = OrgCensusRDS | undefined;

function collapseCensusDataToGridSelections(orgCensusList: OrgCensus[]): GridSelections[] {
  const result: GridSelections[] = [];

  orgCensusList.forEach(orgCensus => {
    if (!orgCensus) {
      return;
    }

    orgCensus.dateRanges.forEach(dateRange => {
      const dateRangeStr = `(${dateRange.startDate?.toISOString() || ''}-${dateRange.endDate?.toISOString() || ''})`;
      const label = `${orgCensus.plotCensusNumber}-${dateRange.censusID}-${dateRangeStr}`;
      const value = dateRange.censusID;
      result.push({ label, value });
    });
  });

  return result;
}

class OrgCensusToCensusResultMapper {
  private censusMapper: IDataMapper<CensusRDS, CensusResult>;
  constructor() {
    this.censusMapper = MapperFactory.getMapper('census');
  }

  mapData(orgCensusList: OrgCensusRDS[]): CensusResult[] {
    const censusRDSList: CensusRDS[] = [];

    // Convert OrgCensusRDS to CensusRDS
    orgCensusList.forEach(orgCensus => {
      orgCensus.dateRanges.forEach(dateRange => {
        const censusRDS: CensusRDS = {
          censusID: dateRange.censusID,
          plotID: orgCensus.plotID,
          plotCensusNumber: orgCensus.plotCensusNumber,
          startDate: dateRange.startDate ? new Date(dateRange.startDate) : undefined,
          endDate: dateRange.endDate ? new Date(dateRange.endDate) : undefined,
          description: orgCensus.description
        };
        censusRDSList.push(censusRDS);
      });
    });

    // Convert CensusRDS to CensusResult
    return this.censusMapper.demapData(censusRDSList);
  }

  demapData(censusResultList: CensusResult[]): OrgCensusRDS[] {
    const censusRDSList: CensusRDS[] = this.censusMapper.mapData(censusResultList);
    const uniqueCensusMap = new Map<number, OrgCensusRDS>();

    censusRDSList.forEach(censusRDS => {
      if (!censusRDS) throw new Error('censusRDS is undefined');

      const plotCensusNumber = censusRDS.plotCensusNumber!;
      const censusID = censusRDS.censusID!;
      const startDate = censusRDS.startDate ? new Date(censusRDS.startDate) : undefined;
      const endDate = censusRDS.endDate ? new Date(censusRDS.endDate) : undefined;
      const description = censusRDS.description || '';

      let existingCensus = uniqueCensusMap.get(plotCensusNumber);

      if (!existingCensus) {
        existingCensus = {
          plotID: censusRDS.plotID!,
          plotCensusNumber,
          censusIDs: [censusID],
          dateRanges: [{ censusID, startDate, endDate }],
          description
        };
        uniqueCensusMap.set(plotCensusNumber, existingCensus);
      } else {
        existingCensus.censusIDs.push(censusID);
        existingCensus.dateRanges.push({ censusID, startDate, endDate });

        // Sort dateRanges by censusID in descending order
        existingCensus.dateRanges.sort((a, b) => b.censusID - a.censusID);
      }
    });

    // Convert the map to an array and sort by plotCensusNumber in descending order
    return Array.from(uniqueCensusMap.values()).sort((a, b) => b.plotCensusNumber - a.plotCensusNumber);
  }

  findOpenCensusID(orgCensus: OrgCensusRDS): number | undefined {
    const openDateRange = orgCensus.dateRanges.find(dateRange => dateRange.endDate === undefined);
    return openDateRange ? openDateRange.censusID : undefined;
  }

  findClosedCensusID(orgCensus: OrgCensusRDS): number | undefined {
    const closedDateRange = orgCensus.dateRanges.find(dateRange => dateRange.endDate !== undefined);
    return closedDateRange ? closedDateRange.censusID : undefined;
  }

  // New methods to close and reopen a census
  async closeCensus(schema: string, plotCensusNumber: number, endDate: Date, censusData: OrgCensusRDS[]): Promise<void> {
    const censusToClose = censusData.find(census => census.plotCensusNumber === plotCensusNumber);
    if (!censusToClose) {
      throw new Error('Census not found');
    }

    const openCensusID = this.findOpenCensusID(censusToClose);
    if (!openCensusID) {
      throw new Error('No open census found to close');
    }

    // Make a PATCH request to update the end date of the open census
    const updatedCensusRDS: CensusRDS = {
      censusID: openCensusID,
      plotID: censusToClose.plotID,
      plotCensusNumber: censusToClose.plotCensusNumber,
      startDate: censusToClose.dateRanges.find(dateRange => dateRange.censusID === openCensusID)?.startDate,
      endDate: endDate,
      description: censusToClose.description
    };

    // Perform the PATCH request
    await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newRow: updatedCensusRDS })
    });
    // need to trigger site reload
  }

  async reopenCensus(schema: string, plotCensusNumber: number, startDate: Date, censusData: OrgCensusRDS[]): Promise<void> {
    const censusToReopen = censusData.find(census => census.plotCensusNumber === plotCensusNumber);
    if (!censusToReopen) {
      throw new Error('Census not found');
    }

    // Create a new CensusRDS object with the new start date
    const newCensusRDS: CensusRDS = {
      censusID: 0, // This will be replaced with the actual ID after the POST request
      plotID: censusToReopen.plotID,
      plotCensusNumber: censusToReopen.plotCensusNumber,
      startDate: startDate,
      endDate: undefined,
      description: censusToReopen.description
    };

    // Perform the POST request
    await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newRow: newCensusRDS })
    });
    // trigger reload
  }

  async startNewCensus(schema: string, plotID: number, plotCensusNumber: number, description?: string): Promise<number | undefined> {
    const newCensusRDS: CensusRDS = {
      censusID: 0, // This will be replaced with the actual ID after the POST request
      plotID: plotID,
      plotCensusNumber: plotCensusNumber,
      startDate: undefined,
      endDate: undefined,
      description: description
    };
    // Perform the POST request
    const response = await fetch(`/api/fixeddata/census/${schema}/censusID`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ newRow: newCensusRDS })
    });
    const responseJSON = await response.json();
    return responseJSON.createdID;
  }
}

// Function to create and update OrgCensusRDS list from CensusRDS
async function createAndUpdateCensusList(censusRDSLoad: CensusRDS[]): Promise<OrgCensusRDS[]> {
  const orgCensusMapper = new OrgCensusToCensusResultMapper();

  const censusResultList: CensusResult[] = MapperFactory.getMapper<CensusRDS, CensusResult>('census').demapData(
    censusRDSLoad.filter(data => data !== undefined)
  );
  return orgCensusMapper.demapData(censusResultList);
}

export { OrgCensusToCensusResultMapper, createAndUpdateCensusList, collapseCensusDataToGridSelections };
export type { CensusDateRange, OrgCensusRDS };

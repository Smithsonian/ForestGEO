// data import class --> currently unused, earmarked for future implementation
// intended to simplify the process of shifting quadrats in a PCN from one census to another (full OR partial)
import { getConn, runQuery } from "@/components/processors/processormacros";
import { format } from "mysql2/promise";

interface CensusData {
  censusID: number;
}

export interface DataConfig<T extends Partial<CensusData>> {
  schema: string;
  tableName: string;
  uniqueField: keyof T;
  selectQuery: string;
  insertQuery: string;
}

class DataImporter<T extends Partial<CensusData>> {
  private config: DataConfig<T>;

  constructor(config: DataConfig<T>) {
    this.config = config;
  }

  async fetchDataByPlotCensusNumber(plotCensusNumber: number): Promise<T[]> {
    const conn = await getConn();
    try {
      const rows = await runQuery(conn, this.config.selectQuery, [plotCensusNumber]);
      return rows as T[];
    } finally {
      conn.release();
    }
  }

  async insertData(data: T, newCensusID: number): Promise<void> {
    const conn = await getConn();
    try {
      const newData = { ...data, censusID: newCensusID } as CensusData & T;
      const values = Object.values(newData);
      await runQuery(conn, format(this.config.insertQuery, values));
    } finally {
      conn.release();
    }
  }

  async copyUniqueData(fromPlotCensusNumber: number, newCensusID: number): Promise<void> {
    const data = await this.fetchDataByPlotCensusNumber(fromPlotCensusNumber);

    const uniqueDataMap = new Map<string, T>();

    data.forEach(item => {
      const uniqueFieldValue = item[this.config.uniqueField];
      if (!uniqueDataMap.has(uniqueFieldValue as any) || uniqueDataMap.get(uniqueFieldValue as any)!.censusID! < item.censusID!) {
        uniqueDataMap.set(uniqueFieldValue as any, item);
      }
    });

    for (const item of uniqueDataMap.values()) {
      await this.insertData(item, newCensusID);
    }
  }
}

export default DataImporter;

// reference custom data type
import {IDataMapper, parseDate} from '../../datamapper';

export type ReferenceRDS = {
  id?: number;
  referenceID?: number;
  publicationTitle?: string;
  fullReference?: string;
  dateOfPublication?: Date;
};

export interface ReferenceResult {
  ReferenceID: any;
  PublicationTitle: any;
  FullReference: any;
  DateOfPublication: any;
}

export class ReferenceMapper implements IDataMapper<ReferenceResult, ReferenceRDS> {
  demapData(results: ReferenceRDS[]): ReferenceResult[] {
    return results.map(item => ({
      ReferenceID: item.referenceID != undefined ? String(item.referenceID) : null,
      PublicationTitle: item.publicationTitle != undefined ? String(item.publicationTitle) : null,
      FullReference: item.fullReference != undefined ? String(item.fullReference) : null,
      DateOfPublication: item.dateOfPublication != undefined ? item.dateOfPublication.toISOString() : null,
    }));
  }

  mapData(results: ReferenceResult[], indexOffset: number = 1): ReferenceRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      publicationTitle: item.PublicationTitle != null ? String(item.PublicationTitle) : undefined,
      fullReference: item.FullReference != null ? String(item.FullReference) : undefined,
      dateOfPublication: item.DateOfPublication != null ? parseDate(item.DateOfPublication) : undefined,
    }));
  }
}



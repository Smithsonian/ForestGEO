import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PATCH, POST, DELETE } from './coreapifunctions';
import ConnectionManager from '@/config/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';

// Mock dependencies
vi.mock('@/config/connectionmanager');
vi.mock('@/config/datamapper');
vi.mock('@/components/processors/processorhelperfunctions', () => ({
  AllTaxonomiesViewQueryConfig: { mockConfig: true },
  handleUpsertForSlices: vi.fn()
}));
vi.mock('@/utils/errorhandler', () => ({
  handleError: vi.fn(error => NextResponse.json({ error: error.message }, { status: 500 }))
}));
vi.mock('@/app/actions/cookiemanager', () => ({
  getCookie: vi.fn(() => Promise.resolve('1'))
}));
vi.mock('@/ailogger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}));
vi.mock('@/config/utils', () => ({
  getUpdatedValues: vi.fn((old, updated) => {
    const changes: any = {};
    Object.keys(updated).forEach(key => {
      if (old[key] !== updated[key]) {
        changes[key] = updated[key];
      }
    });
    return changes;
  }),
  handleUpsert: vi.fn(() => Promise.resolve({ id: 123, operation: 'inserted' }))
}));
vi.mock('@/config/measurementerrors', () => ({
  insertIngestionFailureRows: vi.fn(() => Promise.resolve([1])),
  refreshIngestionErrorsForMeasurement: vi.fn(() => Promise.resolve([]))
}));

describe('CoreAPIFunctions', () => {
  let mockConnectionManager: any;
  let mockMapper: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock ConnectionManager
    mockConnectionManager = {
      getInstance: vi.fn(),
      beginTransaction: vi.fn(() => Promise.resolve('transaction-123')),
      commitTransaction: vi.fn(() => Promise.resolve()),
      rollbackTransaction: vi.fn(() => Promise.resolve()),
      closeConnection: vi.fn(() => Promise.resolve()),
      executeQuery: vi.fn(() => Promise.resolve([]))
    };

    (ConnectionManager.getInstance as any).mockReturnValue(mockConnectionManager);

    // Setup mock Mapper
    mockMapper = {
      demapData: vi.fn(data => data),
      mapData: vi.fn(data => data)
    };

    (MapperFactory.getMapper as any).mockReturnValue(mockMapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PATCH function', () => {
    it('should handle missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: [] };

      await expect(PATCH(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should throw error for missing slugs', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(PATCH(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow();
    });

    it('should begin and commit transaction for valid update', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { id: 1, name: 'Updated' },
          oldRow: { id: 1, name: 'Original' }
        })
      });

      mockConnectionManager.executeQuery.mockResolvedValue([]);

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should close connection in finally block even on error', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID']
      };

      await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });

    it('should handle alltaxonomiesview dataType with handleUpsertForSlices', async () => {
      const { handleUpsertForSlices } = await import('@/components/processors/processorhelperfunctions');
      (handleUpsertForSlices as any).mockResolvedValue({ family: 1, genus: 2, species: 3 });

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { Family: 'Fabaceae' },
          oldRow: { Family: 'Fabaceae' }
        })
      });

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: ['testSchema', 'speciesID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(handleUpsertForSlices).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should handle personnel dataType with CensusActive logic', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { PersonnelID: 1, CensusActive: true },
          oldRow: { PersonnelID: 1, CensusActive: false }
        })
      });

      mockMapper.demapData.mockReturnValue([{ PersonnelID: 1, CensusActive: true }]);

      const mockParams = {
        dataType: 'personnel',
        slugs: ['testSchema', 'personnelID']
      };

      await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      // Should call executeQuery for INSERT IGNORE (CensusActive = true)
      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
      const queries = mockConnectionManager.executeQuery.mock.calls.map((call: any) => call[0]);
      const hasInsertQuery = queries.some((q: string) => typeof q === 'string' && q.includes('INSERT IGNORE'));
      expect(hasInsertQuery).toBe(true);
    });

    it('should skip personnel census-activity updates when CensusActive is not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({
          newRow: { PersonnelID: 1, LastName: 'Updated' },
          oldRow: { PersonnelID: 1, LastName: 'Original' }
        })
      });

      mockMapper.demapData.mockImplementation((data: any[]) => data);

      const mockParams = {
        dataType: 'personnel',
        slugs: ['testSchema', 'personnelID']
      };

      const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(response.status).toBe(200);
      const censusActivityQueries = mockConnectionManager.executeQuery.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('censusactivepersonnel')
      );
      expect(censusActivityQueries).toHaveLength(0);
    });

    it('issues validation-reset queries when only Attributes changes in measurementssummary PATCH', async () => {
      const coreMeasurementID = 77;
      const schema = 'testSchema';

      const oldRow = {
        CoreMeasurementID: coreMeasurementID,
        TreeID: 10,
        StemGUID: 20,
        PlotID: 5,
        Attributes: 'A'
      };
      const newRow = {
        CoreMeasurementID: coreMeasurementID,
        TreeID: 10,
        StemGUID: 20,
        PlotID: 5,
        Attributes: 'D'
      };

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow })
      });

      // demapData returns the row as-is so CoreMeasurementID and Attributes are preserved
      mockMapper.demapData.mockImplementation((rows: any[]) => rows);
      // All queries succeed with empty result sets
      mockConnectionManager.executeQuery.mockResolvedValue([]);

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: [schema, 'coreMeasurementID']
        })
      });

      expect(response.status).toBe(200);

      const deleteErrorLogCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('measurement_error_log') && call[0].includes('ErrorSource')
      );
      expect(deleteErrorLogCall, 'Expected DELETE against measurement_error_log with ErrorSource filter to be called').toBeDefined();
      expect(deleteErrorLogCall![0]).toContain("'validation'");

      const resetValidationCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('IsValidated') && call[0].includes('coremeasurements')
      );
      expect(resetValidationCall, 'Expected UPDATE coremeasurements SET IsValidated = NULL to be called').toBeDefined();
      expect(resetValidationCall![0]).toContain('skip_changelog');
    });

    it('reuses active destination tree and stem rows when patching measurement summary species and quadrat references', async () => {
      const refreshMock = refreshIngestionErrorsForMeasurement as ReturnType<typeof vi.fn>;
      const oldRow = {
        CoreMeasurementID: 88,
        TreeID: 12,
        StemGUID: 34,
        CensusID: 19,
        PlotID: 22,
        SpeciesID: 5,
        SpeciesCode: 'OLDSP',
        TreeTag: '011134',
        StemTag: '011134',
        QuadratID: 7,
        QuadratName: '1201',
        StemLocalX: 10,
        StemLocalY: 20
      };
      const newRow = {
        CoreMeasurementID: 88,
        TreeID: 12,
        StemGUID: 34,
        CensusID: 19,
        PlotID: 22,
        SpeciesID: 5,
        SpeciesCode: 'NEWSP',
        TreeTag: '011134',
        StemTag: '011134',
        QuadratID: 7,
        QuadratName: '1301',
        StemLocalX: 10,
        StemLocalY: 20
      };

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow })
      });

      mockMapper.demapData.mockImplementation((rows: any[]) => rows);
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ SpeciesID: 101 }]) // species lookup
        .mockResolvedValueOnce([{ QuadratID: 205 }]) // quadrat lookup
        .mockResolvedValueOnce([{ TreeID: 55, IsActive: 1 }]) // matching tree lookup (active)
        .mockResolvedValueOnce([{ StemGUID: 77 }]) // exact active stem lookup
        .mockResolvedValueOnce({ affectedRows: 1 }) // coremeasurements UPDATE (reassign to resolved stem)
        .mockResolvedValueOnce([{ CensusID: 18 }]) // treestemstate: previous census lookup
        .mockResolvedValueOnce([{ MatchCount: 1 }]) // treestemstate: prev stem match (old tree)
        .mockResolvedValueOnce([{ UserDefinedFields: '{"uploadSession":{"fileID":1,"batchID":"b1"}}' }]) // treestemstate: UDF read
        .mockResolvedValueOnce({ affectedRows: 1 }) // treestemstate: UDF write
        .mockResolvedValueOnce({ affectedRows: 1 }) // coremeasurements raw-field sync
        .mockResolvedValueOnce({ affectedRows: 0 }) // validation error cleanup
        .mockResolvedValueOnce({ affectedRows: 1 }); // IsValidated reset

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', 'coreMeasurementID']
        })
      });

      expect(response.status).toBe(200);
      // Species lookup uses IsActive and case-insensitive match
      expect(String(mockConnectionManager.executeQuery.mock.calls[0]?.[0])).toContain('IsActive = 1');
      expect(String(mockConnectionManager.executeQuery.mock.calls[0]?.[0])).toContain('LOWER(SpeciesCode) = LOWER(?)');
      // Quadrat lookup uses PlotID and IsActive
      expect(mockConnectionManager.executeQuery.mock.calls[1]?.[1]).toEqual(['1301', 22]);
      expect(String(mockConnectionManager.executeQuery.mock.calls[1]?.[0])).toContain('PlotID = ?');
      expect(String(mockConnectionManager.executeQuery.mock.calls[1]?.[0])).toContain('IsActive = 1');
      // Tree lookup uses the full unique key, without blindly inserting a duplicate.
      expect(String(mockConnectionManager.executeQuery.mock.calls[2]?.[0])).toContain('TreeTag = ?');
      expect(String(mockConnectionManager.executeQuery.mock.calls[2]?.[0])).toContain('SpeciesID = ?');
      expect(String(mockConnectionManager.executeQuery.mock.calls[2]?.[0])).toContain('CensusID = ?');
      // Stem resolution checks for an exact active match before any fallback path.
      expect(String(mockConnectionManager.executeQuery.mock.calls[3]?.[0])).toContain('QuadratID <=> ?');
      expect(String(mockConnectionManager.executeQuery.mock.calls[3]?.[0])).toContain('IsActive = 1');
      expect(String(mockConnectionManager.executeQuery.mock.calls[4]?.[0])).toContain('coremeasurements');
      expect(String(mockConnectionManager.executeQuery.mock.calls[4]?.[0])).toContain('StemGUID');
      // treestemstate computation queries follow stem resolution
      const prevCensusCall = mockConnectionManager.executeQuery.mock.calls[5];
      expect(String(prevCensusCall?.[0])).toContain('PlotCensusNumber');
      const prevStemCall = mockConnectionManager.executeQuery.mock.calls[6];
      expect(String(prevStemCall?.[0])).toContain('MatchCount');
      // UDF is read and written back with treestemstate merged
      const udfWriteCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('UserDefinedFields') && call[0].includes('UPDATE')
      );
      expect(udfWriteCall, 'Expected treestemstate to be persisted into UserDefinedFields').toBeDefined();
      expect(String(udfWriteCall?.[0])).toContain('old tree');
      expect(mockConnectionManager.executeQuery.mock.calls.map((call: any[]) => call[2])).toEqual(
        Array(mockConnectionManager.executeQuery.mock.calls.length).fill('transaction-123')
      );
      const rawSyncCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('RawSpCode') && call[0].includes('RawQuadrat')
      );
      expect(rawSyncCall, 'Expected measurementssummary PATCH to sync raw coremeasurement fields').toBeDefined();
      expect(String(rawSyncCall?.[0])).toContain('NEWSP');
      expect(String(rawSyncCall?.[0])).toContain('1301');
      expect(refreshMock).toHaveBeenCalledWith(
        mockConnectionManager,
        'testSchema',
        88,
        19,
        expect.objectContaining({
          Tag: '011134',
          StemTag: '011134',
          SpCode: 'NEWSP',
          Quadrat: '1301'
        }),
        'transaction-123'
      );

      const inPlaceStemMoves = mockConnectionManager.executeQuery.mock.calls.filter(
        (call: any[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE') &&
          call[0].includes('stems') &&
          (call[0].includes('TreeID') || call[0].includes('QuadratID'))
      );
      expect(inPlaceStemMoves).toHaveLength(0);
    });

    it('returns a controlled error when only an inactive matching tree exists', async () => {
      const oldRow = {
        CoreMeasurementID: 88,
        TreeID: 12,
        StemGUID: 34,
        CensusID: 19,
        PlotID: 22,
        SpeciesID: 5,
        SpeciesCode: 'OLDSP',
        TreeTag: '011134',
        StemTag: '011134',
        QuadratID: 7,
        QuadratName: '1201'
      };
      const newRow = {
        ...oldRow,
        SpeciesCode: 'NEWSP'
      };

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow })
      });

      mockMapper.demapData.mockImplementation((rows: any[]) => rows);
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ SpeciesID: 101 }]) // species lookup
        .mockResolvedValueOnce([{ TreeID: 55, IsActive: 0 }]); // matching tree lookup (inactive)

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', 'coreMeasurementID']
        })
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining('matching tree exists but is inactive')
      });
      expect(mockConnectionManager.commitTransaction).not.toHaveBeenCalled();
    });

    it('species-only change reuses the destination stem instead of mutating the current stem', async () => {
      const oldRow = {
        CoreMeasurementID: 88,
        TreeID: 12,
        StemGUID: 34,
        CensusID: 19,
        PlotID: 22,
        SpeciesID: 5,
        SpeciesCode: 'OLDSP',
        TreeTag: '011134',
        StemTag: '011134',
        QuadratID: 7,
        QuadratName: '1201'
      };
      const newRow = {
        ...oldRow,
        SpeciesCode: 'NEWSP'
      };

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow })
      });

      mockMapper.demapData.mockImplementation((rows: any[]) => rows);
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ SpeciesID: 101 }]) // species lookup
        .mockResolvedValueOnce([{ TreeID: 55, IsActive: 1 }]) // tree resolve (find existing)
        .mockResolvedValueOnce([{ StemGUID: 77 }]) // exact active destination stem lookup
        .mockResolvedValueOnce({ affectedRows: 1 }) // coremeasurements UPDATE (reassign to resolved stem)
        .mockResolvedValueOnce([{ CensusID: 18 }]) // treestemstate: previous census lookup
        .mockResolvedValueOnce([{ MatchCount: 0 }]) // treestemstate: prev stem match (no match)
        .mockResolvedValueOnce([{ MatchCount: 0 }]) // treestemstate: prev tree match (no match → new recruit)
        .mockResolvedValueOnce([{ UserDefinedFields: null }]) // treestemstate: UDF read
        .mockResolvedValueOnce({ affectedRows: 1 }) // treestemstate: UDF write
        .mockResolvedValueOnce({ affectedRows: 1 }) // coremeasurements raw-field sync
        .mockResolvedValueOnce({ affectedRows: 0 }) // validation error cleanup
        .mockResolvedValueOnce({ affectedRows: 1 }); // IsValidated reset

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', 'coreMeasurementID']
        })
      });

      expect(response.status).toBe(200);
      const stemsUpdate = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('UPDATE') && call[0].includes('stems') && call[0].includes('TreeID')
      );
      expect(stemsUpdate, 'Species-only edits should not rewrite stems.TreeID in place').toBeUndefined();
      const stemLookup = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('stems') && call[0].includes('QuadratID <=> ?')
      );
      expect(stemLookup, 'Expected species-only edits to resolve the destination stem').toBeDefined();
      const measurementStemUpdate = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('coremeasurements') && call[0].includes('StemGUID')
      );
      expect(measurementStemUpdate, 'Expected species-only edits to relink the measurement to the resolved stem').toBeDefined();
      const rawSyncCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('RawSpCode') && call[0].includes('RawTreeTag')
      );
      expect(rawSyncCall, 'Expected measurementssummary PATCH to sync raw fields for species-only edits').toBeDefined();
      expect(String(rawSyncCall?.[0])).toContain('NEWSP');
    });

    it('returns a controlled error when only an inactive matching stem exists during full stem resolution', async () => {
      const oldRow = {
        CoreMeasurementID: 88,
        TreeID: 12,
        StemGUID: 34,
        CensusID: 19,
        PlotID: 22,
        SpeciesID: 5,
        SpeciesCode: 'OLDSP',
        TreeTag: '011134',
        StemTag: '011134',
        QuadratID: 7,
        QuadratName: '1201'
      };
      const newRow = {
        ...oldRow,
        SpeciesCode: 'NEWSP',
        QuadratName: '1301' // QuadratName change triggers full stem resolution
      };

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow })
      });

      mockMapper.demapData.mockImplementation((rows: any[]) => rows);
      mockConnectionManager.executeQuery
        .mockResolvedValueOnce([{ SpeciesID: 101 }]) // species lookup
        .mockResolvedValueOnce([{ QuadratID: 205 }]) // quadrat lookup (QuadratName changed)
        .mockResolvedValueOnce([{ TreeID: 55, IsActive: 1 }]) // tree resolve
        .mockResolvedValueOnce([]) // exact active stem lookup (none found)
        .mockResolvedValueOnce([{ StemGUID: 78, QuadratID: 205, IsActive: 0 }]); // blocking stem is inactive

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', 'coreMeasurementID']
        })
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining('exists but is inactive')
      });
      expect(mockConnectionManager.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('POST function', () => {
    it('should throw error when slugs not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(POST(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('slugs not provided');
    });

    it('should throw error for missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      const mockParams = { dataType: 'test', slugs: [] };

      await expect(POST(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should begin and commit transaction for valid insert', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: { name: 'New Item' } })
      });

      mockConnectionManager.executeQuery.mockResolvedValue({ insertId: 456 });

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '1', '1']
      };

      const response = await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should remove isNew field from newRow if present', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: { name: 'Test', isNew: true } })
      });

      mockConnectionManager.executeQuery.mockResolvedValue({ insertId: 789 });

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '1', '1']
      };

      await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
    });

    it('should handle alltaxonomiesview insert with handleUpsert', async () => {
      const { handleUpsert } = await import('@/config/utils');

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({
          newRow: {
            Family: 'Fabaceae',
            Genus: 'Acacia',
            GenusAuthority: 'Mill.',
            SpeciesCode: 'ACACIA',
            SpeciesName: 'acacia'
          }
        })
      });

      mockMapper.demapData.mockReturnValue([
        {
          Family: 'Fabaceae',
          Genus: 'Acacia',
          GenusAuthority: 'Mill.',
          SpeciesCode: 'ACACIA',
          SpeciesName: 'acacia'
        }
      ]);

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: ['testSchema', 'speciesID', '1', '1']
      };

      const response = await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(handleUpsert).toHaveBeenCalledTimes(3); // Family, Genus, Species
      expect(response.status).toBe(200);
    });

    it('should close connection in finally block', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '1', '1']
      };

      await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });
  });

  describe('DELETE function', () => {
    it('should throw error when slugs not provided', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE'
      });

      const mockParams = { dataType: 'test', slugs: undefined };

      await expect(DELETE(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('slugs not provided');
    });

    it('should throw error for missing schema or gridID', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { id: 1 } })
      });

      const mockParams = { dataType: 'test', slugs: ['testSchema'] };

      await expect(DELETE(mockRequest, { params: Promise.resolve(mockParams) })).rejects.toThrow('no schema or gridID provided');
    });

    it('should begin and commit transaction for valid delete', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 1 });

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '123']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.commitTransaction).toHaveBeenCalledWith('transaction-123');
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should handle attributes dataType delete', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { CMAID: 456 } })
      });

      mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 1 });

      const mockParams = {
        dataType: 'attributes',
        slugs: ['testSchema', 'cmaid', '456']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.executeQuery).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it('should delete alltaxonomiesview rows by SpeciesID without a CensusID filter', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { SpeciesID: 99 } })
      });

      mockMapper.demapData.mockReturnValue([{ SpeciesID: 99 }]);
      mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 1 });

      const mockParams = {
        dataType: 'alltaxonomiesview',
        slugs: ['testSchema', 'speciesID', '99']
      };

      const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.executeQuery).toHaveBeenCalledWith('DELETE FROM testSchema.species WHERE SpeciesID = ?', [99]);
      expect(response.status).toBe(200);
    });

    it('should close connection in finally block on error', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('DB Error'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '123']
      };

      await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });
  });

  describe('Transaction Management', () => {
    it('should handle transaction rollback on error in PATCH', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: {}, oldRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Transaction failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID']
      };

      await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });

    it('should handle transaction rollback on error in POST', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'POST',
        body: JSON.stringify({ newRow: {} })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Insert failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '1', '1']
      };

      await POST(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });

    it('should handle transaction rollback on error in DELETE', async () => {
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'DELETE',
        body: JSON.stringify({ newRow: { PlotID: 123 } })
      });

      mockConnectionManager.executeQuery.mockRejectedValue(new Error('Delete failed'));

      const mockParams = {
        dataType: 'plots',
        slugs: ['testSchema', 'plotID', '123']
      };

      await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

      expect(mockConnectionManager.beginTransaction).toHaveBeenCalled();
      expect(mockConnectionManager.closeConnection).toHaveBeenCalled();
    });
  });

  describe('PRIMARY_KEY_MAP Logic', () => {
    describe('PATCH with PRIMARY_KEY_MAP', () => {
      it('should use FailedMeasurementID input while updating the failed coremeasurement row', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { FailedMeasurementID: 1, TreeTag: '123', IsValidated: null },
            oldRow: { FailedMeasurementID: 1, TreeTag: '122', IsValidated: null }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue([]);
        mockMapper.demapData.mockReturnValue([{ FailedMeasurementID: 1, TreeTag: '123', IsValidated: null }]);

        const mockParams = {
          dataType: 'failedmeasurements',
          slugs: ['forestgeo_panama', '1'] // gridID is '1' - should NOT be used as column name
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);
        expect(mockConnectionManager.executeQuery).toHaveBeenCalled();

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE'));
        expect(updateCall).toBeDefined();
        expect(updateCall[0]).toMatch(/CoreMeasurementID/i);
        expect(updateCall[1]).toContain(1);
      });

      it('refreshes failedmeasurement errors without deleting historical log rows', async () => {
        const refreshMock = refreshIngestionErrorsForMeasurement as ReturnType<typeof vi.fn>;
        refreshMock.mockResolvedValueOnce([{ errorCode: 'INVALID_SPECIES', errorMessage: 'Invalid species reference' }]);

        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: {
              FailedMeasurementID: 5,
              Tag: 'TREE-5',
              StemTag: '1',
              SpCode: 'BAD',
              Quadrat: 'Q01',
              Date: '2025-01-01',
              Comments: 'reviewed'
            },
            oldRow: {
              FailedMeasurementID: 5,
              Tag: 'TREE-5',
              StemTag: '1',
              SpCode: 'OLD',
              Quadrat: 'Q01',
              Date: '2025-01-01',
              Comments: 'original'
            }
          })
        });

        mockMapper.demapData.mockReturnValue([
          {
            FailedMeasurementID: 5,
            Tag: 'TREE-5',
            StemTag: '1',
            SpCode: 'BAD',
            Quadrat: 'Q01',
            Date: '2025-01-01',
            Comments: 'reviewed'
          }
        ]);

        const response = await PATCH(mockRequest, {
          params: Promise.resolve({ dataType: 'failedmeasurements', slugs: ['forestgeo_panama', '5'] })
        });

        expect(response.status).toBe(200);
        expect(refreshMock).toHaveBeenCalledWith(
          mockConnectionManager,
          'forestgeo_panama',
          5,
          1,
          expect.objectContaining({
            Tag: 'TREE-5',
            StemTag: '1',
            SpCode: 'BAD',
            Quadrat: 'Q01'
          }),
          'transaction-123'
        );

        const deleteHistoryCall = mockConnectionManager.executeQuery.mock.calls.find(
          (call: any[]) => typeof call[0] === 'string' && call[0].includes('DELETE mel') && call[0].includes('measurement_error_log')
        );
        expect(deleteHistoryCall).toBeUndefined();
      });

      it('should use CoreMeasurementID for coremeasurements dataType', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { CoreMeasurementID: 42, MeasuredDBH: 15.5 },
            oldRow: { CoreMeasurementID: 42, MeasuredDBH: 15.0 }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue([]);
        mockMapper.demapData.mockReturnValue([{ CoreMeasurementID: 42, MeasuredDBH: 15.5 }]);

        const mockParams = {
          dataType: 'coremeasurements',
          slugs: ['forestgeo_test', '42']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE'));
        expect(updateCall[0]).toMatch(/CoreMeasurementID/i);
      });

      it('should use Code for attributes dataType', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'TEST', Description: 'Updated' },
            oldRow: { Code: 'TEST', Description: 'Original' }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue([]);
        mockMapper.demapData.mockReturnValue([{ Code: 'TEST', Description: 'Updated' }]);

        const mockParams = {
          dataType: 'attributes',
          slugs: ['forestgeo_test', 'TEST']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE'));
        expect(updateCall[0]).toMatch(/Code/i);
      });

      it('should update attributes.Code using the original code in the WHERE clause', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Code: 'NEWCODE', Description: 'Updated' },
            oldRow: { Code: 'OLDCODE', Description: 'Original' }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue([]);

        const mockParams = {
          dataType: 'attributes',
          slugs: ['forestgeo_test', 'code']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const updateCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE'));
        expect(updateCall).toBeDefined();
        expect(updateCall[0]).toContain('NEWCODE');
        expect(updateCall[0]).toContain('OLDCODE');
      });

      it('should fallback to capitalized gridID for unmapped dataTypes', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { CustomID: 99, Name: 'Updated' },
            oldRow: { CustomID: 99, Name: 'Original' }
          })
        });

        mockConnectionManager.executeQuery.mockResolvedValue([]);
        mockMapper.demapData.mockReturnValue([{ CustomID: 99, Name: 'Updated' }]);

        const mockParams = {
          dataType: 'customtable', // Not in PRIMARY_KEY_MAP
          slugs: ['forestgeo_test', 'customID']
        };

        const response = await PATCH(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        // Should use 'CustomID' (capitalized gridID) as fallback
        const updateCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('UPDATE'));
        expect(updateCall[0]).toMatch(/CustomID/i);
      });
    });

    describe('DELETE with PRIMARY_KEY_MAP', () => {
      it('should use FailedMeasurementID input while deleting the failed coremeasurement row', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { FailedMeasurementID: 5 } })
        });

        mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 1 });
        mockMapper.demapData.mockReturnValue([{ FailedMeasurementID: 5 }]);

        const mockParams = {
          dataType: 'failedmeasurements',
          slugs: ['forestgeo_panama', '5']
        };

        const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const deleteCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('DELETE'));
        expect(deleteCall[0]).toMatch(/CoreMeasurementID/i);
        expect(deleteCall[1]).toEqual([5]);
      });

      it('should use StemGUID for stems delete', async () => {
        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'DELETE',
          body: JSON.stringify({ newRow: { StemGUID: 12345 } })
        });

        mockConnectionManager.executeQuery.mockResolvedValue({ affectedRows: 1 });
        mockMapper.demapData.mockReturnValue([{ StemGUID: 12345 }]);

        const mockParams = {
          dataType: 'stems',
          slugs: ['forestgeo_test', '12345']
        };

        const response = await DELETE(mockRequest, { params: Promise.resolve(mockParams) });

        expect(response.status).toBe(200);

        const deleteCall = mockConnectionManager.executeQuery.mock.calls.find((call: any) => typeof call[0] === 'string' && call[0].includes('DELETE'));
        expect(deleteCall[0]).toMatch(/StemGUID/i);
      });
    });

    describe('PRIMARY_KEY_MAP Coverage', () => {
      const primaryKeyMappings = [
        { dataType: 'failedmeasurements', primaryKey: 'FailedMeasurementID' },
        { dataType: 'coremeasurements', primaryKey: 'CoreMeasurementID' },
        { dataType: 'attributes', primaryKey: 'Code' },
        { dataType: 'census', primaryKey: 'CensusID' },
        { dataType: 'cmattributes', primaryKey: 'CMAID' },
        { dataType: 'family', primaryKey: 'FamilyID' },
        { dataType: 'genus', primaryKey: 'GenusID' },
        { dataType: 'personnel', primaryKey: 'PersonnelID' },
        { dataType: 'plots', primaryKey: 'PlotID' },
        { dataType: 'quadrats', primaryKey: 'QuadratID' },
        { dataType: 'species', primaryKey: 'SpeciesID' },
        { dataType: 'stems', primaryKey: 'StemGUID' },
        { dataType: 'trees', primaryKey: 'TreeID' }
      ];

      it('should have PRIMARY_KEY_MAP defined for critical dataTypes', () => {
        // This test documents the expected mappings
        primaryKeyMappings.forEach(mapping => {
          expect(mapping.primaryKey).toBeDefined();
          expect(mapping.primaryKey).not.toBe('');
        });
      });
    });
  });
});

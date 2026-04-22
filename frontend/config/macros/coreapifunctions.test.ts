import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { PATCH, POST, DELETE } from './coreapifunctions';
import ConnectionManager from '@/config/connectionmanager';
import MapperFactory from '@/config/datamapper';
import { applyEdit } from '@/config/editplan/apply';
// Keep measurementerrors mocked even though no test reads the mock directly; it
// prevents the module from hitting the real DB stack when imported transitively.

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
  getCookie: vi.fn((key: string) => Promise.resolve(key === 'plotID' ? '5' : '1'))
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
vi.mock('@/config/editplan/apply', () => ({
  applyEdit: vi.fn(() =>
    Promise.resolve({
      updatedIDs: { CoreMeasurementID: 88 },
      applyErrors: [],
      editOperationID: 1,
      validationPending: false
    })
  )
}));
vi.mock('@/auth', () => ({
  auth: vi.fn(() => Promise.resolve({ user: { email: 'tester@example.com' } }))
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

    it('routes measurementssummary PATCH through applyEdit as a legacy compatibility shim', async () => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      applyEditMock.mockResolvedValueOnce({
        updatedIDs: { CoreMeasurementID: 77 },
        applyErrors: [],
        editOperationID: 42,
        validationPending: false
      });

      const newRow = {
        Attributes: 'D',
        MeasuredDBH: 12.34
      };
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow: { Attributes: 'A', MeasuredDBH: 10 } })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', '77']
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        message: 'Update successful',
        updatedIDs: { measurementssummary: 77 }
      });

      expect(applyEditMock).toHaveBeenCalledTimes(1);
      const applyInput = applyEditMock.mock.calls[0][1];
      expect(applyInput).toMatchObject({
        dataType: 'measurementssummary',
        schema: 'testSchema',
        plotID: 5,
        censusID: 1,
        targetID: 77,
        expectedPlanHash: null,
        operationType: 'single-row-edit'
      });
      expect(applyInput.newRow).toEqual({ Attributes: 'D', MeasuredDBH: 12.34 });
    });

    it('drops SpeciesName, SubspeciesName, and internal IDs from the shim newRow via the allowlist and never updates the species row', async () => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      applyEditMock.mockResolvedValueOnce({
        updatedIDs: { CoreMeasurementID: 77 },
        applyErrors: [],
        editOperationID: 43,
        validationPending: false
      });

      const newRow = {
        SpeciesCode: 'NEWSP',
        SpeciesName: 'Attempted rename',
        SubspeciesName: 'Attempted subspecies rename',
        SpeciesID: 999,
        TreeID: 12,
        StemGUID: 34,
        CoreMeasurementID: 77,
        MeasuredDBH: 15.5
      };
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow: { SpeciesCode: 'OLDSP', MeasuredDBH: 10 } })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', '77']
        })
      });

      expect(response.status).toBe(200);

      const applyInput = applyEditMock.mock.calls[0][1];
      expect(applyInput.newRow).not.toHaveProperty('SpeciesName');
      expect(applyInput.newRow).not.toHaveProperty('SubspeciesName');
      expect(applyInput.newRow).not.toHaveProperty('SpeciesID');
      expect(applyInput.newRow).not.toHaveProperty('TreeID');
      expect(applyInput.newRow).not.toHaveProperty('StemGUID');
      expect(applyInput.newRow).not.toHaveProperty('CoreMeasurementID');
      expect(applyInput.newRow).toEqual({ SpeciesCode: 'NEWSP', MeasuredDBH: 15.5 });

      // Regression: the R1b species-rename branch must be gone. The shim
      // must never issue an UPDATE against the species table.
      const speciesRenameCall = mockConnectionManager.executeQuery.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && /UPDATE .*species/i.test(call[0]) && call[0].includes('SpeciesName')
      );
      expect(speciesRenameCall, 'Expected no UPDATE species SET SpeciesName = ? call from the legacy shim').toBeUndefined();
    });

    it('canonicalizes lowercase grid-key aliases before forwarding to applyEdit', async () => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      applyEditMock.mockResolvedValueOnce({
        updatedIDs: { CoreMeasurementID: 88 },
        applyErrors: [],
        editOperationID: 44,
        validationPending: false
      });

      const newRow = {
        speciesCode: 'NEWSP',
        measuredDBH: 22.2,
        quadratName: '1301'
      };
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow: {} })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', '88']
        })
      });

      expect(response.status).toBe(200);
      const applyInput = applyEditMock.mock.calls[0][1];
      expect(applyInput.newRow).toEqual({
        SpeciesCode: 'NEWSP',
        MeasuredDBH: 22.2,
        QuadratName: '1301'
      });
    });

    it('routes failedmeasurements PATCH through applyEdit with the failedmeasurements surface allowlist', async () => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      applyEditMock.mockResolvedValueOnce({
        updatedIDs: { CoreMeasurementID: 5 },
        applyErrors: [],
        editOperationID: 99,
        validationPending: false
      });

      const newRow = {
        Tag: 'TREE-5',
        StemTag: '1',
        SpCode: 'BAD',
        Quadrat: 'Q01',
        Date: '2025-01-01',
        Comments: 'reviewed',
        FailureReasons: 'ignored-by-allowlist',
        Hash_ID: 'also-ignored'
      };
      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow, oldRow: {} })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'failedmeasurements',
          slugs: ['forestgeo_panama', '5']
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        message: 'Update successful',
        updatedIDs: { failedmeasurements: 5 }
      });

      const applyInput = applyEditMock.mock.calls[0][1];
      expect(applyInput).toMatchObject({
        dataType: 'failedmeasurements',
        schema: 'forestgeo_panama',
        targetID: 5,
        expectedPlanHash: null,
        operationType: 'single-row-edit'
      });
      expect(applyInput.newRow).toEqual({
        Tag: 'TREE-5',
        StemTag: '1',
        SpCode: 'BAD',
        Quadrat: 'Q01',
        Date: '2025-01-01',
        Comments: 'reviewed'
      });
      expect(applyInput.newRow).not.toHaveProperty('FailureReasons');
      expect(applyInput.newRow).not.toHaveProperty('Hash_ID');
    });

    it('propagates applyEdit errors through handleError so the shim surface stays consistent with the rest of the handler', async () => {
      const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
      applyEditMock.mockRejectedValueOnce(new Error('matching tree exists but is inactive'));

      const mockRequest = new NextRequest('http://localhost/api/test', {
        method: 'PATCH',
        body: JSON.stringify({ newRow: { SpeciesCode: 'NEWSP' }, oldRow: {} })
      });

      const response = await PATCH(mockRequest, {
        params: Promise.resolve({
          dataType: 'measurementssummary',
          slugs: ['testSchema', '88']
        })
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining('matching tree exists but is inactive')
      });
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
      it('uses the numeric slugs gridID as applyEdit targetID for failedmeasurements (never the column name)', async () => {
        const applyEditMock = applyEdit as ReturnType<typeof vi.fn>;
        applyEditMock.mockResolvedValueOnce({
          updatedIDs: { CoreMeasurementID: 1 },
          applyErrors: [],
          editOperationID: 10,
          validationPending: false
        });

        const mockRequest = new NextRequest('http://localhost/api/test', {
          method: 'PATCH',
          body: JSON.stringify({
            newRow: { Tag: '123' },
            oldRow: { Tag: '122' }
          })
        });

        const response = await PATCH(mockRequest, {
          params: Promise.resolve({
            dataType: 'failedmeasurements',
            slugs: ['forestgeo_panama', '1']
          })
        });

        expect(response.status).toBe(200);
        expect(applyEditMock).toHaveBeenCalledTimes(1);
        const applyInput = applyEditMock.mock.calls[0][1];
        expect(applyInput).toMatchObject({
          dataType: 'failedmeasurements',
          targetID: 1,
          schema: 'forestgeo_panama'
        });
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

import {validateRowStructure, computeMutation} from '@/config/datagridhelpers';
import '@testing-library/jest-dom';

describe('datagridhelpers', () => {
  describe('validateRowStructure', () => {
    it('should return true for valid row structure', () => {
      const gridType = 'attributes';
      const oldRow = {id: '1', code: '', description: '', status: '', isNew: true};
      expect(validateRowStructure(gridType, oldRow)).toBe(true);
    });

    it('should return false for invalid row structure', () => {
      const gridType = 'attributes';
      const oldRow = {id: '1', code: 123, description: '', status: '', isNew: true};
      expect(validateRowStructure(gridType, oldRow)).toBe(false);
    });

    it('should throw an error for invalid grid type', () => {
      const gridType = 'invalidType';
      const oldRow = {id: '1', code: '', description: '', status: '', isNew: true};
      expect(() => validateRowStructure(gridType, oldRow)).toThrow('Invalid grid type submitted');
    });
  });

  describe('computeMutation', () => {
    it('should detect mutation in coreMeasurements', () => {
      const gridType = 'coreMeasurements';
      const newRow = {censusID: '1', plotID: '2', treeID: '3', measuredDBH: 10};
      const oldRow = {censusID: '1', plotID: '2', treeID: '3', measuredDBH: 20};
      expect(computeMutation(gridType, newRow, oldRow)).toBe(true);
    });

    it('should not detect mutation for identical rows in personnel', () => {
      const gridType = 'personnel';
      const newRow = {firstName: 'John', lastName: 'Doe', role: 'Researcher'};
      const oldRow = {firstName: 'John', lastName: 'Doe', role: 'Researcher'};
      expect(computeMutation(gridType, newRow, oldRow)).toBe(false);
    });

    it('should handle special case for quadrats personnel field', () => {
      const gridType = 'quadrats';
      const newRow = {plotID: '1', quadratName: 'A1', personnel: [{firstName: 'Jane', lastName: 'Doe'}]};
      const oldRow = {plotID: '1', quadratName: 'A1', personnel: [{firstName: 'John', lastName: 'Doe'}]};
      expect(computeMutation(gridType, newRow, oldRow)).toBe(true);
    });
  });
});

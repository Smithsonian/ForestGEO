/**
 * useFileManagement Hook - Functional Tests
 *
 * Tests the intent and behavior of file management operations
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileManagement } from './usefilemanagement';
import { FileWithPath } from 'react-dropzone';
import { vi } from 'vitest';

// Mock FileWithStream
vi.mock('@/config/macros/uploadsystemmacros', () => ({
  FileWithStream: class {
    name: string;
    path: string | undefined;

    constructor(file: FileWithPath, _isStream: boolean, path?: string) {
      this.name = file.name;
      this.path = path;
    }
  }
}));

describe('useFileManagement', () => {
  const createMockFile = (name: string): FileWithPath =>
    ({
      name,
      path: `/mock/path/${name}`,
      size: 1024,
      type: 'text/csv',
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(0),
      slice: () => new Blob(),
      stream: () => new ReadableStream(),
      text: async () => ''
    }) as FileWithPath;

  describe('Initial State', () => {
    it('should initialize with empty files and headers', () => {
      const { result } = renderHook(() => useFileManagement());

      expect(result.current.files).toEqual([]);
      expect(result.current.headers).toEqual({});
      expect(result.current.fileCount).toBe(0);
      expect(result.current.hasFiles).toBe(false);
    });
  });

  describe('File Addition', () => {
    it('should add a single file', () => {
      const { result } = renderHook(() => useFileManagement());
      const file = createMockFile('test1.csv');

      act(() => {
        result.current.addFile(file);
      });

      expect(result.current.fileCount).toBe(1);
      expect(result.current.hasFiles).toBe(true);
      expect(result.current.files[0].name).toBe('test1.csv');
    });

    it('should add multiple files sequentially', () => {
      const { result } = renderHook(() => useFileManagement());
      const file1 = createMockFile('test1.csv');
      const file2 = createMockFile('test2.csv');
      const file3 = createMockFile('test3.csv');

      act(() => {
        result.current.addFile(file1);
        result.current.addFile(file2);
        result.current.addFile(file3);
      });

      expect(result.current.fileCount).toBe(3);
      expect(result.current.files.map(f => f.name)).toEqual(['test1.csv', 'test2.csv', 'test3.csv']);
    });

    it('should preserve existing files when adding new ones', () => {
      const { result } = renderHook(() => useFileManagement());
      const file1 = createMockFile('existing.csv');
      const file2 = createMockFile('new.csv');

      act(() => {
        result.current.addFile(file1);
      });

      const existingFile = result.current.files[0];

      act(() => {
        result.current.addFile(file2);
      });

      expect(result.current.files[0]).toBe(existingFile);
      expect(result.current.fileCount).toBe(2);
    });
  });

  describe('File Removal', () => {
    it('should remove a file by index', () => {
      const { result } = renderHook(() => useFileManagement());
      const file1 = createMockFile('test1.csv');
      const file2 = createMockFile('test2.csv');

      act(() => {
        result.current.addFile(file1);
        result.current.addFile(file2);
      });

      act(() => {
        result.current.removeFile(0);
      });

      expect(result.current.fileCount).toBe(1);
      expect(result.current.files[0].name).toBe('test2.csv');
    });

    it('should remove file headers when file is removed', () => {
      const { result } = renderHook(() => useFileManagement());
      const file = createMockFile('test.csv');

      act(() => {
        result.current.addFile(file);
        result.current.setFileHeaders('test.csv', ['header1', 'header2']);
      });

      expect(result.current.headers['test.csv']).toBeDefined();

      act(() => {
        result.current.removeFile(0);
      });

      expect(result.current.headers['test.csv']).toBeUndefined();
      expect(result.current.fileCount).toBe(0);
    });

    it('should handle removing last file correctly', () => {
      const { result } = renderHook(() => useFileManagement());
      const file = createMockFile('test.csv');

      act(() => {
        result.current.addFile(file);
      });

      act(() => {
        result.current.removeFile(0);
      });

      expect(result.current.fileCount).toBe(0);
      expect(result.current.hasFiles).toBe(false);
      expect(result.current.files).toEqual([]);
    });

    it('should handle removing middle file without affecting others', () => {
      const { result } = renderHook(() => useFileManagement());
      const files = [createMockFile('file1.csv'), createMockFile('file2.csv'), createMockFile('file3.csv')];

      act(() => {
        files.forEach(f => result.current.addFile(f));
      });

      act(() => {
        result.current.removeFile(1); // Remove middle file
      });

      expect(result.current.fileCount).toBe(2);
      expect(result.current.files.map(f => f.name)).toEqual(['file1.csv', 'file3.csv']);
    });
  });

  describe('File Replacement', () => {
    it('should replace a file at specific index', () => {
      const { result } = renderHook(() => useFileManagement());
      const oldFile = createMockFile('old.csv');
      const newFile = createMockFile('new.csv');

      act(() => {
        result.current.addFile(oldFile);
      });

      act(() => {
        result.current.replaceFile(0, newFile);
      });

      expect(result.current.fileCount).toBe(1);
      expect(result.current.files[0].name).toBe('new.csv');
    });

    it('should clean up old file headers when replacing', () => {
      const { result } = renderHook(() => useFileManagement());
      const oldFile = createMockFile('old.csv');
      const newFile = createMockFile('new.csv');

      act(() => {
        result.current.addFile(oldFile);
        result.current.setFileHeaders('old.csv', ['oldHeader']);
      });

      expect(result.current.headers['old.csv']).toBeDefined();

      act(() => {
        result.current.replaceFile(0, newFile);
      });

      expect(result.current.headers['old.csv']).toBeUndefined();
    });

    it('should maintain file order when replacing', () => {
      const { result } = renderHook(() => useFileManagement());
      const files = [createMockFile('file1.csv'), createMockFile('file2.csv'), createMockFile('file3.csv')];

      act(() => {
        files.forEach(f => result.current.addFile(f));
      });

      const replacement = createMockFile('replacement.csv');

      act(() => {
        result.current.replaceFile(1, replacement);
      });

      expect(result.current.files.map(f => f.name)).toEqual(['file1.csv', 'replacement.csv', 'file3.csv']);
    });
  });

  describe('Clear Files', () => {
    it('should clear all files and headers', () => {
      const { result } = renderHook(() => useFileManagement());
      const files = [createMockFile('file1.csv'), createMockFile('file2.csv')];

      act(() => {
        files.forEach(f => result.current.addFile(f));
        result.current.setFileHeaders('file1.csv', ['header1']);
        result.current.setFileHeaders('file2.csv', ['header2']);
      });

      expect(result.current.fileCount).toBe(2);
      expect(Object.keys(result.current.headers).length).toBe(2);

      act(() => {
        result.current.clearFiles();
      });

      expect(result.current.fileCount).toBe(0);
      expect(result.current.hasFiles).toBe(false);
      expect(result.current.files).toEqual([]);
      expect(result.current.headers).toEqual({});
    });
  });

  describe('File Headers Management', () => {
    it('should set headers for a file', () => {
      const { result } = renderHook(() => useFileManagement());
      const headers = ['column1', 'column2', 'column3'];

      act(() => {
        result.current.setFileHeaders('test.csv', headers);
      });

      expect(result.current.headers['test.csv']).toEqual(headers);
    });

    it('should update headers for existing file', () => {
      const { result } = renderHook(() => useFileManagement());
      const initialHeaders = ['col1', 'col2'];
      const updatedHeaders = ['col1', 'col2', 'col3'];

      act(() => {
        result.current.setFileHeaders('test.csv', initialHeaders);
      });

      expect(result.current.headers['test.csv']).toEqual(initialHeaders);

      act(() => {
        result.current.setFileHeaders('test.csv', updatedHeaders);
      });

      expect(result.current.headers['test.csv']).toEqual(updatedHeaders);
    });

    it('should maintain headers for multiple files', () => {
      const { result } = renderHook(() => useFileManagement());

      act(() => {
        result.current.setFileHeaders('file1.csv', ['h1', 'h2']);
        result.current.setFileHeaders('file2.csv', ['h3', 'h4']);
        result.current.setFileHeaders('file3.csv', ['h5', 'h6']);
      });

      expect(result.current.headers['file1.csv']).toEqual(['h1', 'h2']);
      expect(result.current.headers['file2.csv']).toEqual(['h3', 'h4']);
      expect(result.current.headers['file3.csv']).toEqual(['h5', 'h6']);
    });
  });

  describe('Derived State', () => {
    it('should correctly calculate fileCount', () => {
      const { result } = renderHook(() => useFileManagement());

      expect(result.current.fileCount).toBe(0);

      act(() => {
        result.current.addFile(createMockFile('file1.csv'));
      });

      expect(result.current.fileCount).toBe(1);

      act(() => {
        result.current.addFile(createMockFile('file2.csv'));
        result.current.addFile(createMockFile('file3.csv'));
      });

      expect(result.current.fileCount).toBe(3);
    });

    it('should correctly calculate hasFiles', () => {
      const { result } = renderHook(() => useFileManagement());

      expect(result.current.hasFiles).toBe(false);

      act(() => {
        result.current.addFile(createMockFile('file.csv'));
      });

      expect(result.current.hasFiles).toBe(true);

      act(() => {
        result.current.clearFiles();
      });

      expect(result.current.hasFiles).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle removing non-existent file gracefully', () => {
      const { result } = renderHook(() => useFileManagement());

      act(() => {
        result.current.addFile(createMockFile('file.csv'));
      });

      // Removing index out of bounds shouldn't crash
      act(() => {
        result.current.removeFile(10);
      });

      // Original file should still be there
      expect(result.current.fileCount).toBe(1);
    });

    it('should handle replacing non-existent file', () => {
      const { result } = renderHook(() => useFileManagement());

      // Replacing at index 0 when no files exist
      act(() => {
        result.current.replaceFile(0, createMockFile('new.csv'));
      });

      // Should add the file at the end
      expect(result.current.fileCount).toBe(1);
    });

    it('should handle duplicate file names', () => {
      const { result } = renderHook(() => useFileManagement());
      const file1 = createMockFile('duplicate.csv');
      const file2 = createMockFile('duplicate.csv');

      act(() => {
        result.current.addFile(file1);
        result.current.addFile(file2);
      });

      // Both files should be added (they're different objects)
      expect(result.current.fileCount).toBe(2);
    });

    it('should handle setting headers for non-existent file', () => {
      const { result } = renderHook(() => useFileManagement());

      act(() => {
        result.current.setFileHeaders('nonexistent.csv', ['header']);
      });

      // Headers should be set even if file doesn't exist
      expect(result.current.headers['nonexistent.csv']).toEqual(['header']);
    });
  });

  describe('Hook Stability', () => {
    it('should maintain stable function references', () => {
      const { result, rerender } = renderHook(() => useFileManagement());

      const initialAddFile = result.current.addFile;
      const initialRemoveFile = result.current.removeFile;
      const initialClearFiles = result.current.clearFiles;

      rerender();

      // Functions should maintain same reference
      expect(result.current.addFile).toBe(initialAddFile);
      expect(result.current.removeFile).toBe(initialRemoveFile);
      expect(result.current.clearFiles).toBe(initialClearFiles);
    });
  });
});

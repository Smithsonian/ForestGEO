/**
 * useFileManagement Hook
 *
 * Manages file operations for the upload system:
 * - Adding files
 * - Removing files
 * - Replacing files
 * - Managing file headers
 *
 * Reduces uploadparent.tsx state complexity by extracting file-related logic
 */

import { useState, useCallback } from 'react';
import { FileWithStream } from '@/config/macros/uploadsystemmacros';
import { FileWithPath } from 'react-dropzone';

export interface UseFileManagementReturn {
  // State
  files: FileWithStream[];
  headers: Record<string, string[]>;

  // Actions
  addFile: (newFile: FileWithPath) => void;
  removeFile: (fileIndex: number) => void;
  replaceFile: (fileIndex: number, newFile: FileWithPath) => void;
  clearFiles: () => void;
  setFileHeaders: (fileName: string, headers: string[]) => void;

  // Derived state
  fileCount: number;
  hasFiles: boolean;
}

/**
 * Custom hook for managing file operations in upload system
 *
 * @example
 * const { files, addFile, removeFile, hasFiles } = useFileManagement();
 *
 * // Add a file
 * addFile(droppedFile);
 *
 * // Remove a file
 * removeFile(0);
 *
 * // Check if files exist
 * if (hasFiles) {
 *   // Process files
 * }
 */
export function useFileManagement(): UseFileManagementReturn {
  const [files, setFiles] = useState<FileWithStream[]>([]);
  const [headers, setHeaders] = useState<Record<string, string[]>>({});

  /**
   * Add a new file to the collection
   */
  const addFile = useCallback((newFile: FileWithPath) => {
    setFiles(prevFiles => [...prevFiles, new FileWithStream(newFile, true, newFile.path)]);
  }, []);

  /**
   * Remove a file by index and clean up its headers
   */
  const removeFile = useCallback((fileIndex: number) => {
    setFiles(prevFiles => {
      const fileToRemove = prevFiles[fileIndex];

      // Clean up headers
      if (fileToRemove) {
        setHeaders(prevHeaders => {
          const updatedHeaders = { ...prevHeaders };
          delete updatedHeaders[fileToRemove.name];
          return updatedHeaders;
        });
      }

      return prevFiles.filter((_, index) => index !== fileIndex);
    });
  }, []);

  /**
   * Replace a file at a specific index and clean up old headers
   */
  const replaceFile = useCallback((fileIndex: number, newFile: FileWithPath) => {
    setFiles(prevFiles => {
      const fileToReplace = prevFiles[fileIndex];

      // Clean up old headers
      if (fileToReplace) {
        setHeaders(prevHeaders => {
          const updatedHeaders = { ...prevHeaders };
          delete updatedHeaders[fileToReplace.name];
          return updatedHeaders;
        });
      }

      return [...prevFiles.slice(0, fileIndex), new FileWithStream(newFile, true, newFile.path), ...prevFiles.slice(fileIndex + 1)];
    });
  }, []);

  /**
   * Clear all files and headers
   */
  const clearFiles = useCallback(() => {
    setFiles([]);
    setHeaders({});
  }, []);

  /**
   * Set headers for a specific file
   */
  const setFileHeaders = useCallback((fileName: string, fileHeaders: string[]) => {
    setHeaders(prevHeaders => ({
      ...prevHeaders,
      [fileName]: fileHeaders
    }));
  }, []);

  return {
    // State
    files,
    headers,

    // Actions
    addFile,
    removeFile,
    replaceFile,
    clearFiles,
    setFileHeaders,

    // Derived state
    fileCount: files.length,
    hasFiles: files.length > 0
  };
}

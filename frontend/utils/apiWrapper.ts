'use client';

import { useLoading } from '@/app/contexts/loadingprovider';

type LoadingCategory = 'api' | 'upload' | 'processing' | 'general';

interface ApiWrapperOptions {
  loadingMessage?: string;
  category?: LoadingCategory;
  showErrorAlert?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number; // Timeout in milliseconds (default: 60000ms = 1 minute)
  acceptedStatuses?: number[]; // Additional status codes to treat as success (e.g., [412] for validation endpoints)
}

/**
 * Loading context interface - subset of LoadingContextType used by ApiWrapper
 */
interface ApiWrapperLoadingContext {
  startOperation: (message: string, category?: LoadingCategory) => string;
  endOperation: (operationId: string) => void;
}

/**
 * Enhanced fetch wrapper that automatically manages loading states
 * Provides retry logic, error handling, and loading state management
 */
export class ApiWrapper {
  private static loadingContext: ApiWrapperLoadingContext | null = null;

  // Initialize with loading context (called from a hook)
  static initialize(loadingContext: ApiWrapperLoadingContext): void {
    ApiWrapper.loadingContext = loadingContext;
  }

  // Getter for external access (used by withLoadingState)
  static getLoadingContext(): ApiWrapperLoadingContext | null {
    return ApiWrapper.loadingContext;
  }

  /**
   * Wrapped fetch with automatic loading states and timeout protection
   */
  static async fetch(url: string, init: RequestInit = {}, options: ApiWrapperOptions = {}): Promise<Response> {
    const {
      loadingMessage = 'Loading...',
      category = 'api',
      showErrorAlert = true,
      retryAttempts = 1,
      retryDelay = 1000,
      timeout = 60000, // Default 60 second timeout
      acceptedStatuses = [] // Additional status codes to treat as success
    } = options;

    if (!ApiWrapper.loadingContext) {
      console.warn('ApiWrapper not initialized with loading context. Loading states will not work.');
      return fetch(url, init);
    }

    const { startOperation, endOperation } = ApiWrapper.loadingContext;
    const operationId = startOperation(loadingMessage, category);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Check if response is ok OR if status is in acceptedStatuses
        const isAccepted = response.ok || acceptedStatuses.includes(response.status);
        if (!isAccepted) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        endOperation(operationId);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${timeout}ms`);
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        // If this is the last attempt or not a network error, break
        if (attempt === retryAttempts - 1 || !ApiWrapper.isRetryableError(lastError)) {
          break;
        }

        // Wait before retrying
        if (retryDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        console.warn(`Retry attempt ${attempt + 1}/${retryAttempts} for ${url}:`, lastError.message);
      }
    }

    // All attempts failed
    endOperation(operationId);

    if (showErrorAlert && lastError) {
      alert(`Request failed: ${lastError.message}`);
    }

    throw lastError;
  }

  /**
   * POST request wrapper
   */
  static async post(url: string, data: unknown, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
    const { headers = {}, ...apiOptions } = options;

    return ApiWrapper.fetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(data)
      },
      {
        loadingMessage: 'Saving data...',
        category: 'processing',
        ...apiOptions
      }
    );
  }

  /**
   * PUT request wrapper
   */
  static async put(url: string, data: unknown, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
    const { headers = {}, ...apiOptions } = options;

    return ApiWrapper.fetch(
      url,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(data)
      },
      {
        loadingMessage: 'Updating data...',
        category: 'processing',
        ...apiOptions
      }
    );
  }

  /**
   * DELETE request wrapper
   */
  static async delete(url: string, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
    const { headers = {}, ...apiOptions } = options;

    return ApiWrapper.fetch(
      url,
      {
        method: 'DELETE',
        headers
      },
      {
        loadingMessage: 'Deleting data...',
        category: 'processing',
        ...apiOptions
      }
    );
  }

  /**
   * GET request wrapper
   */
  static async get(url: string, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
    const { headers = {}, ...apiOptions } = options;

    return ApiWrapper.fetch(
      url,
      {
        method: 'GET',
        headers
      },
      {
        loadingMessage: 'Fetching data...',
        category: 'api',
        ...apiOptions
      }
    );
  }

  /**
   * Upload file wrapper
   */
  static async uploadFile(
    url: string,
    file: File | FormData,
    options: ApiWrapperOptions & {
      onProgress?: (progress: number) => void;
      headers?: Record<string, string>;
    } = {}
  ): Promise<Response> {
    const { onProgress, headers = {}, ...apiOptions } = options;

    if (!ApiWrapper.loadingContext) {
      throw new Error('ApiWrapper not initialized with loading context');
    }

    const { startOperation, endOperation } = ApiWrapper.loadingContext;
    const operationId = startOperation(apiOptions.loadingMessage || 'Uploading file...', 'upload');

    // FIXED: Handle async completion properly - endOperation must be called inside Promise handlers
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      if (onProgress) {
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            onProgress(progress);
          }
        });
      }

      xhr.addEventListener('load', () => {
        endOperation(operationId); // End operation on completion
        if (xhr.status >= 200 && xhr.status < 300) {
          // Create a Response-like object
          const response = new Response(xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText
          });
          resolve(response);
        } else {
          const error = new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`);
          if (apiOptions.showErrorAlert !== false) {
            alert(`Upload failed: ${error.message}`);
          }
          reject(error);
        }
      });

      xhr.addEventListener('error', () => {
        endOperation(operationId); // End operation on error
        const error = new Error('Upload failed due to network error');
        if (apiOptions.showErrorAlert !== false) {
          alert(`Upload failed: ${error.message}`);
        }
        reject(error);
      });

      xhr.addEventListener('timeout', () => {
        endOperation(operationId); // End operation on timeout
        const error = new Error('Upload timed out');
        if (apiOptions.showErrorAlert !== false) {
          alert(`Upload failed: ${error.message}`);
        }
        reject(error);
      });

      xhr.open('POST', url);

      // Set headers (don't set Content-Type for FormData, browser will set it with boundary)
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      // Send file or FormData
      const body =
        file instanceof File
          ? (() => {
              const formData = new FormData();
              formData.append('file', file);
              return formData;
            })()
          : file;

      xhr.send(body);
    });
  }

  /**
   * Check if an error is retryable
   */
  private static isRetryableError(error: Error): boolean {
    const retryableMessages = ['network error', 'timeout', 'connection refused', 'ECONNRESET', 'ENOTFOUND', 'ECONNABORTED'];

    const message = error.message.toLowerCase();
    return retryableMessages.some(msg => message.includes(msg));
  }
}

/**
 * Hook to initialize API wrapper with loading context
 * Call this in your root component or high-level components
 */
export function useApiWrapper() {
  // Use static import - tree-shakeable and optimizable by bundler
  const loadingContext = useLoading();

  // Initialize the wrapper
  ApiWrapper.initialize(loadingContext);

  return ApiWrapper;
}

/**
 * Utility function to wrap existing fetch calls
 */
export function withLoadingState<T extends unknown[], R>(
  asyncFn: (...args: T) => Promise<R>,
  loadingMessage: string = 'Processing...',
  category: LoadingCategory = 'general'
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const loadingContext = ApiWrapper.getLoadingContext();
    if (!loadingContext) {
      console.warn('ApiWrapper not initialized. Loading states will not work.');
      return asyncFn(...args);
    }

    const { startOperation, endOperation } = loadingContext;
    const operationId = startOperation(loadingMessage, category);

    try {
      const result = await asyncFn(...args);
      return result;
    } finally {
      endOperation(operationId);
    }
  };
}

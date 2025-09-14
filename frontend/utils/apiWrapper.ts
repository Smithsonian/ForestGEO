'use client';

interface ApiWrapperOptions {
  loadingMessage?: string;
  category?: 'api' | 'upload' | 'processing' | 'general';
  showErrorAlert?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Enhanced fetch wrapper that automatically manages loading states
 * Provides retry logic, error handling, and loading state management
 */
export class ApiWrapper {
  public static loadingContext: any = null;

  // Initialize with loading context (called from a hook)
  static initialize(loadingContext: any) {
    ApiWrapper.loadingContext = loadingContext;
  }

  /**
   * Wrapped fetch with automatic loading states
   */
  static async fetch(url: string, init: RequestInit = {}, options: ApiWrapperOptions = {}): Promise<Response> {
    const { loadingMessage = 'Loading...', category = 'api', showErrorAlert = true, retryAttempts = 1, retryDelay = 1000 } = options;

    if (!ApiWrapper.loadingContext) {
      console.warn('ApiWrapper not initialized with loading context. Loading states will not work.');
      return fetch(url, init);
    }

    const { startOperation, endOperation } = ApiWrapper.loadingContext;
    const operationId = startOperation(loadingMessage, category);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retryAttempts; attempt++) {
      try {
        const response = await fetch(url, init);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        endOperation(operationId);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

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
  static async post(url: string, data: any, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
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
  static async put(url: string, data: any, options: ApiWrapperOptions & { headers?: Record<string, string> } = {}): Promise<Response> {
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

    try {
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
          if (xhr.status >= 200 && xhr.status < 300) {
            // Create a Response-like object
            const response = new Response(xhr.responseText, {
              status: xhr.status,
              statusText: xhr.statusText
            });
            resolve(response);
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed due to network error'));
        });

        xhr.addEventListener('timeout', () => {
          reject(new Error('Upload timed out'));
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
    } catch (error) {
      endOperation(operationId);

      if (apiOptions.showErrorAlert !== false) {
        const errorMsg = error instanceof Error ? error.message : 'Upload failed';
        alert(`Upload failed: ${errorMsg}`);
      }

      throw error;
    } finally {
      endOperation(operationId);
    }
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
  if (typeof window !== 'undefined') {
    try {
      // Dynamic import to avoid issues during SSR
      const { useLoading } = require('@/app/contexts/loadingprovider');
      const loadingContext = useLoading();

      // Initialize the wrapper
      ApiWrapper.initialize(loadingContext);

      return ApiWrapper;
    } catch (error) {
      console.warn('Failed to initialize API wrapper:', error);
      return ApiWrapper;
    }
  }

  return ApiWrapper;
}

/**
 * Utility function to wrap existing fetch calls
 */
export function withLoadingState<T extends any[], R>(
  asyncFn: (...args: T) => Promise<R>,
  loadingMessage: string = 'Processing...',
  category: 'api' | 'upload' | 'processing' | 'general' = 'general'
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    if (!ApiWrapper.loadingContext) {
      console.warn('ApiWrapper not initialized. Loading states will not work.');
      return asyncFn(...args);
    }

    const { startOperation, endOperation } = ApiWrapper.loadingContext;
    const operationId = startOperation(loadingMessage, category);

    try {
      const result = await asyncFn(...args);
      return result;
    } finally {
      endOperation(operationId);
    }
  };
}

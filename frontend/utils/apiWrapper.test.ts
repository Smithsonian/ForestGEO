/**
 * ApiWrapper Test Suite
 *
 * Tests the enhanced fetch wrapper that manages:
 * - Automatic retry logic with configurable attempts and delays
 * - Timeout protection (default 60s)
 * - Loading state management
 * - Error handling and categorization
 * - File upload with progress tracking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiWrapper, useApiWrapper, withLoadingState } from './apiWrapper';

describe('ApiWrapper', () => {
  let mockLoadingContext: any;
  let mockStartOperation: any;
  let mockEndOperation: any;
  let operationIdCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    operationIdCounter = 0;

    mockStartOperation = vi.fn(() => `operation-${++operationIdCounter}`);
    mockEndOperation = vi.fn();

    mockLoadingContext = {
      startOperation: mockStartOperation,
      endOperation: mockEndOperation
    };

    ApiWrapper.initialize(mockLoadingContext);

    // Mock global fetch
    global.fetch = vi.fn();
    global.alert = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with loading context', () => {
      expect(ApiWrapper.loadingContext).toBe(mockLoadingContext);
    });

    it('should warn when fetch is called without initialization', async () => {
      ApiWrapper.initialize(null);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: 'test' })
      });

      await ApiWrapper.fetch('/test');

      expect(consoleSpy).toHaveBeenCalledWith(
        'ApiWrapper not initialized with loading context. Loading states will not work.'
      );

      consoleSpy.mockRestore();
      ApiWrapper.initialize(mockLoadingContext);
    });
  });

  describe('fetch() - Basic Functionality', () => {
    it('should successfully fetch data', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: 'test' })
      };

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await ApiWrapper.fetch('/api/test');

      expect(response).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('should start and end loading operation', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200
      });

      await ApiWrapper.fetch('/api/test', {}, { loadingMessage: 'Loading data...' });

      expect(mockStartOperation).toHaveBeenCalledWith('Loading data...', 'api');
      expect(mockEndOperation).toHaveBeenCalledWith('operation-1');
    });

    it('should use correct default loading message', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await ApiWrapper.fetch('/api/test');

      expect(mockStartOperation).toHaveBeenCalledWith('Loading...', 'api');
    });

    it('should categorize requests correctly', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await ApiWrapper.fetch('/api/test', {}, { category: 'upload' });
      expect(mockStartOperation).toHaveBeenCalledWith('Loading...', 'upload');

      await ApiWrapper.fetch('/api/test', {}, { category: 'processing' });
      expect(mockStartOperation).toHaveBeenCalledWith('Loading...', 'processing');

      await ApiWrapper.fetch('/api/test', {}, { category: 'general' });
      expect(mockStartOperation).toHaveBeenCalledWith('Loading...', 'general');
    });
  });

  describe('fetch() - Timeout Protection', () => {
    it('should set timeout with custom duration', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // Resolve quickly so test doesn't hang
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await ApiWrapper.fetch('/api/test', {}, { timeout: 5000 });

      // Verify setTimeout was called with our timeout value
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

      setTimeoutSpy.mockRestore();
    });

    it('should use default 60s timeout', async () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // Resolve quickly so test doesn't hang
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await ApiWrapper.fetch('/api/test', {}, {});

      // Verify setTimeout was called with default 60s timeout
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

      setTimeoutSpy.mockRestore();
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await ApiWrapper.fetch('/api/test');

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should clear timeout on error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      (global.fetch as any).mockRejectedValue(new Error('Test error'));

      try {
        await ApiWrapper.fetch('/api/test', {}, { showErrorAlert: false });
      } catch (error) {
        // Expected to throw
      }

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('fetch() - Retry Logic', () => {
    it('should retry on network errors', async () => {
      let attempts = 0;
      (global.fetch as any).mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const response = await ApiWrapper.fetch('/api/test', {}, {
        retryAttempts: 3,
        retryDelay: 0,
        showErrorAlert: false
      });

      expect(attempts).toBe(3);
      expect(response.ok).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Invalid JSON'));

      await expect(
        ApiWrapper.fetch('/api/test', {}, {
          retryAttempts: 3,
          retryDelay: 0,
          showErrorAlert: false
        })
      ).rejects.toThrow('Invalid JSON');

      // Should only try once since error is not retryable
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should respect retryAttempts configuration', async () => {
      (global.fetch as any).mockRejectedValue(new Error('timeout'));

      await expect(
        ApiWrapper.fetch('/api/test', {}, {
          retryAttempts: 5,
          retryDelay: 0,
          showErrorAlert: false
        })
      ).rejects.toThrow();

      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it('should wait between retries', async () => {
      vi.useFakeTimers();

      let callCount = 0;
      (global.fetch as any).mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('connection refused'));
      });

      const promise = ApiWrapper.fetch('/api/test', {}, {
        retryAttempts: 3,
        retryDelay: 100, // Use shorter delay for faster tests
        showErrorAlert: false
      });

      // First attempt happens immediately
      await vi.waitFor(() => expect(callCount).toBe(1));

      // Advance time for first retry delay
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(callCount).toBe(2));

      // Advance time for second retry delay
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(callCount).toBe(3));

      // Catch the rejection to prevent unhandled promise rejection
      try {
        await promise;
      } catch (error: any) {
        expect(error.message).toBe('connection refused');
      }

      vi.useRealTimers();
    });

    it('should identify retryable errors correctly', async () => {
      // Test one retryable error to verify retry logic
      const errorMsg = 'network error';

      (global.fetch as any).mockRejectedValue(new Error(errorMsg));

      try {
        await ApiWrapper.fetch('/api/test', {}, {
          retryAttempts: 2,
          retryDelay: 0,
          showErrorAlert: false
        });
      } catch (error: any) {
        // Expected to throw
      }

      // Should retry (2 attempts)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetch() - Error Handling', () => {
    it('should throw on HTTP error status', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      await expect(
        ApiWrapper.fetch('/api/test', {}, { showErrorAlert: false })
      ).rejects.toThrow('HTTP 404: Not Found');

      expect(mockEndOperation).toHaveBeenCalled();
    });

    it('should show error alert by default', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Test error'));

      await expect(
        ApiWrapper.fetch('/api/test', {}, { retryAttempts: 1 })
      ).rejects.toThrow();

      expect(global.alert).toHaveBeenCalledWith('Request failed: Test error');
    });

    it('should not show alert when showErrorAlert is false', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Test error'));

      await expect(
        ApiWrapper.fetch('/api/test', {}, { retryAttempts: 1, showErrorAlert: false })
      ).rejects.toThrow();

      expect(global.alert).not.toHaveBeenCalled();
    });

    it('should always end loading operation on error', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Test error'));

      await expect(
        ApiWrapper.fetch('/api/test', {}, { showErrorAlert: false })
      ).rejects.toThrow();

      expect(mockEndOperation).toHaveBeenCalledWith('operation-1');
    });
  });

  describe('fetch() - Accepted Status Codes', () => {
    it('should accept custom status codes as success', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 412,
        statusText: 'Precondition Failed'
      });

      const response = await ApiWrapper.fetch('/api/validate', {}, {
        acceptedStatuses: [412]
      });

      expect(response.status).toBe(412);
      expect(mockEndOperation).toHaveBeenCalled();
    });

    it('should accept multiple custom status codes', async () => {
      const statuses = [201, 202, 204, 412];

      for (const status of statuses) {
        (global.fetch as any).mockResolvedValue({
          ok: false,
          status,
          statusText: 'Custom'
        });

        const response = await ApiWrapper.fetch('/api/test', {}, {
          acceptedStatuses: statuses
        });

        expect(response.status).toBe(status);
      }
    });
  });

  describe('HTTP Method Wrappers', () => {
    beforeEach(() => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      });
    });

    describe('get()', () => {
      it('should make GET request', async () => {
        await ApiWrapper.get('/api/users');

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users',
          expect.objectContaining({
            method: 'GET'
          })
        );
      });

      it('should use "Fetching data..." message', async () => {
        await ApiWrapper.get('/api/users');

        expect(mockStartOperation).toHaveBeenCalledWith('Fetching data...', 'api');
      });

      it('should pass custom headers', async () => {
        await ApiWrapper.get('/api/users', {
          headers: { 'X-Custom': 'value' }
        });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users',
          expect.objectContaining({
            headers: { 'X-Custom': 'value' }
          })
        );
      });
    });

    describe('post()', () => {
      it('should make POST request with JSON body', async () => {
        const data = { name: 'John', email: 'john@example.com' };

        await ApiWrapper.post('/api/users', data);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users',
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify(data)
          })
        );
      });

      it('should use "Saving data..." message and processing category', async () => {
        await ApiWrapper.post('/api/users', {});

        expect(mockStartOperation).toHaveBeenCalledWith('Saving data...', 'processing');
      });

      it('should allow custom headers', async () => {
        await ApiWrapper.post('/api/users', {}, {
          headers: { 'X-CSRF-Token': 'token123' }
        });

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users',
          expect.objectContaining({
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
              'X-CSRF-Token': 'token123'
            })
          })
        );
      });
    });

    describe('put()', () => {
      it('should make PUT request with JSON body', async () => {
        const data = { id: 1, name: 'Updated' };

        await ApiWrapper.put('/api/users/1', data);

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users/1',
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify(data)
          })
        );
      });

      it('should use "Updating data..." message', async () => {
        await ApiWrapper.put('/api/users/1', {});

        expect(mockStartOperation).toHaveBeenCalledWith('Updating data...', 'processing');
      });
    });

    describe('delete()', () => {
      it('should make DELETE request', async () => {
        await ApiWrapper.delete('/api/users/1');

        expect(global.fetch).toHaveBeenCalledWith(
          '/api/users/1',
          expect.objectContaining({
            method: 'DELETE'
          })
        );
      });

      it('should use "Deleting data..." message', async () => {
        await ApiWrapper.delete('/api/users/1');

        expect(mockStartOperation).toHaveBeenCalledWith('Deleting data...', 'processing');
      });
    });
  });

  describe('uploadFile()', () => {
    let mockXHR: any;
    let MockXHRConstructor: any;

    beforeEach(() => {
      mockXHR = {
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        upload: {
          addEventListener: vi.fn()
        },
        addEventListener: vi.fn(),
        status: 200,
        statusText: 'OK',
        responseText: JSON.stringify({ success: true })
      };

      // Create a constructor function that returns our mock
      MockXHRConstructor = function() {
        return mockXHR;
      };

      global.XMLHttpRequest = MockXHRConstructor as any;
    });

    it('should upload file using XMLHttpRequest', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file);

      // Simulate successful upload
      const loadHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'load')?.[1];
      loadHandler?.();

      await promise;

      expect(mockXHR.open).toHaveBeenCalledWith('POST', '/api/upload');
      expect(mockXHR.send).toHaveBeenCalled();
    });

    it('should track upload progress', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });
      const onProgress = vi.fn();

      const promise = ApiWrapper.uploadFile('/api/upload', file, { onProgress });

      // Simulate progress event
      const progressHandler = mockXHR.upload.addEventListener.mock.calls.find(
        (call: any) => call[0] === 'progress'
      )?.[1];

      progressHandler?.({ lengthComputable: true, loaded: 50, total: 100 });
      expect(onProgress).toHaveBeenCalledWith(50);

      progressHandler?.({ lengthComputable: true, loaded: 100, total: 100 });
      expect(onProgress).toHaveBeenCalledWith(100);

      // Complete upload
      const loadHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'load')?.[1];
      loadHandler?.();

      await promise;
    });

    it('should use FormData for File input', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file);

      const loadHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'load')?.[1];
      loadHandler?.();

      await promise;

      const sentData = mockXHR.send.mock.calls[0][0];
      expect(sentData).toBeInstanceOf(FormData);
    });

    it('should handle upload errors', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file, { showErrorAlert: false });

      // Simulate error
      const errorHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'error')?.[1];
      errorHandler?.();

      await expect(promise).rejects.toThrow('Upload failed due to network error');
      expect(mockEndOperation).toHaveBeenCalled();
    });

    it('should handle upload timeout', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file, { showErrorAlert: false });

      // Simulate timeout
      const timeoutHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'timeout')?.[1];
      timeoutHandler?.();

      await expect(promise).rejects.toThrow('Upload timed out');
    });

    it('should use upload category and custom loading message', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file, {
        loadingMessage: 'Uploading CSV...'
      });

      expect(mockStartOperation).toHaveBeenCalledWith('Uploading CSV...', 'upload');

      const loadHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'load')?.[1];
      loadHandler?.();

      await promise;
    });

    it('should set custom headers', async () => {
      const file = new File(['content'], 'test.csv', { type: 'text/csv' });

      const promise = ApiWrapper.uploadFile('/api/upload', file, {
        headers: { 'X-File-ID': '12345' }
      });

      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith('X-File-ID', '12345');

      const loadHandler = mockXHR.addEventListener.mock.calls.find((call: any) => call[0] === 'load')?.[1];
      loadHandler?.();

      await promise;
    });
  });

  describe('withLoadingState() utility', () => {
    it('should wrap async function with loading state', async () => {
      const asyncFn = vi.fn().mockResolvedValue('result');

      const wrapped = withLoadingState(asyncFn, 'Processing...', 'processing');

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('result');
      expect(asyncFn).toHaveBeenCalledWith('arg1', 'arg2');
      expect(mockStartOperation).toHaveBeenCalledWith('Processing...', 'processing');
      expect(mockEndOperation).toHaveBeenCalledWith('operation-1');
    });

    it('should end loading even if function throws', async () => {
      const asyncFn = vi.fn().mockRejectedValue(new Error('Failed'));

      const wrapped = withLoadingState(asyncFn);

      await expect(wrapped()).rejects.toThrow('Failed');
      expect(mockEndOperation).toHaveBeenCalled();
    });

    it('should use default loading message and category', async () => {
      const asyncFn = vi.fn().mockResolvedValue('result');

      const wrapped = withLoadingState(asyncFn);
      await wrapped();

      expect(mockStartOperation).toHaveBeenCalledWith('Processing...', 'general');
    });

    it('should warn when not initialized', async () => {
      ApiWrapper.initialize(null);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const asyncFn = vi.fn().mockResolvedValue('result');
      const wrapped = withLoadingState(asyncFn);

      await wrapped();

      expect(consoleSpy).toHaveBeenCalled();
      expect(asyncFn).toHaveBeenCalled();

      consoleSpy.mockRestore();
      ApiWrapper.initialize(mockLoadingContext);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete API workflow', async () => {
      // 1. GET request
      (global.fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ users: [] })
      });

      await ApiWrapper.get('/api/users');
      expect(mockStartOperation).toHaveBeenCalledWith('Fetching data...', 'api');
      expect(mockEndOperation).toHaveBeenCalledTimes(1);

      // 2. POST request
      await ApiWrapper.post('/api/users', { name: 'John' });
      expect(mockStartOperation).toHaveBeenCalledWith('Saving data...', 'processing');
      expect(mockEndOperation).toHaveBeenCalledTimes(2);

      // 3. PUT request
      await ApiWrapper.put('/api/users/1', { name: 'Jane' });
      expect(mockStartOperation).toHaveBeenCalledWith('Updating data...', 'processing');
      expect(mockEndOperation).toHaveBeenCalledTimes(3);

      // 4. DELETE request
      await ApiWrapper.delete('/api/users/1');
      expect(mockStartOperation).toHaveBeenCalledWith('Deleting data...', 'processing');
      expect(mockEndOperation).toHaveBeenCalledTimes(4);
    });

    it('should handle retry and eventual success', async () => {
      let attempts = 0;
      (global.fetch as any).mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      await ApiWrapper.get('/api/data', {
        retryAttempts: 3,
        retryDelay: 0,
        loadingMessage: 'Loading with retry...'
      });

      expect(mockStartOperation).toHaveBeenCalledWith('Loading with retry...', 'api');
      expect(mockEndOperation).toHaveBeenCalledWith('operation-1');
      expect(attempts).toBe(3);
    });
  });
});

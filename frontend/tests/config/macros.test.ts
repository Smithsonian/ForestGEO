import {
  bitToBoolean,
  createEnhancedDispatch,
  FileRowErrors,
  formatDate,
  genericLoadContextReducer,
  genericLoadReducer,
  uploadValidFileAsBuffer
} from '@/config/macros';
import {ContainerClient} from '@azure/storage-blob';
import '@testing-library/jest-dom';

describe('macros', () => {
  describe('bitToBoolean', () => {
    it('should return true for Buffer with first byte as 1', () => {
      const buffer = Buffer.from([1]);
      expect(bitToBoolean(buffer)).toBe(true);
    });

    it('should return false for Buffer with first byte not as 1', () => {
      const buffer = Buffer.from([0]);
      expect(bitToBoolean(buffer)).toBe(false);
    });

    it('should return true for numeric 1', () => {
      expect(bitToBoolean(1)).toBe(true);
    });

    it('should return false for numeric 0', () => {
      expect(bitToBoolean(0)).toBe(false);
    });

    it('should return true for boolean true', () => {
      expect(bitToBoolean(true)).toBe(true);
    });

    it('should return false for boolean false', () => {
      expect(bitToBoolean(false)).toBe(false);
    });

    it('should return true for truthy values', () => {
      expect(bitToBoolean('true')).toBe(true);
    });

    it('should return false for falsy values other than 0', () => {
      expect(bitToBoolean('')).toBe(false);
    });
  });

  describe('createEnhancedDispatch', () => {
    let mockDispatch: any;
    const actionType = 'TEST_ACTION';
    const testData = {key: 'value'};
    const nullData = {key: null};

    beforeEach(() => {
      mockDispatch = jest.fn();
    });

    it('should dispatch the action with payload when payload is not null', async () => {
      const enhancedDispatch = createEnhancedDispatch(mockDispatch, actionType);
      await enhancedDispatch(testData);
      expect(mockDispatch).toHaveBeenCalledWith({type: actionType, payload: testData});
    });

    it('should save data to IndexedDB when payload is not null', async () => {
      const setData = jest.fn();
      setData.mockClear();
      const enhancedDispatch = createEnhancedDispatch(mockDispatch, actionType);
      await enhancedDispatch(testData);
      expect(setData).toHaveBeenCalledWith(actionType, testData.key);
    });

    it('should clear data from IndexedDB when payload is null', async () => {
      const clearDataByKey = jest.fn();
      clearDataByKey.mockClear();
      const enhancedDispatch = createEnhancedDispatch(mockDispatch, actionType);
      await enhancedDispatch(nullData);
      expect(clearDataByKey).toHaveBeenCalledWith(actionType);
    });

    it('should not save null data to IndexedDB', async () => {
      const setData = jest.fn();
      setData.mockClear();
      const enhancedDispatch = createEnhancedDispatch(mockDispatch, actionType);
      await enhancedDispatch(nullData);
      expect(setData).not.toHaveBeenCalled();
    });

    it('should dispatch the action with null payload', async () => {
      const enhancedDispatch = createEnhancedDispatch(mockDispatch, actionType);
      await enhancedDispatch(nullData);
      expect(mockDispatch).toHaveBeenCalledWith({type: actionType, payload: nullData});
    });
  });
  describe('genericLoadReducer', () => {
    const initialState = null;
    const mockPayload = {
      coreMeasurementLoad: {data: 'coreMeasurement'},
      attributeLoad: {data: 'attribute'},
      // Add more mock payloads as needed for testing
    };

    it('should return the payload for a matching action type', () => {
      const action = {type: 'coreMeasurementLoad', payload: mockPayload.coreMeasurementLoad};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(mockPayload.coreMeasurementLoad);
    });

    it('should return the initial state when action type does not match', () => {
      const action = {type: 'nonExistentLoad', payload: mockPayload};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(initialState);
    });

    it('should return the initial state when action type is not in payload', () => {
      const action = {type: 'coreMeasurementLoad', payload: {}};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(initialState);
    });

    it('should handle multiple action types correctly', () => {
      const action = {type: 'attributeLoad', payload: mockPayload.attributeLoad};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(mockPayload.attributeLoad);
    });

    // Test for each action type mentioned in the switch case to ensure coverage
    it('should return the correct state for personnelLoad action type', () => {
      const action = {type: 'personnelLoad', payload: mockPayload};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(initialState); // Assuming mockPayload does not contain personnelLoad
    });

    it('should return null for an undefined action type', () => {
      const action = {type: 'someValidString', payload: mockPayload};
      const newState = genericLoadReducer(initialState, action);
      expect(newState).toEqual(initialState);
    });
  });
  describe('additional macro tests', () => {
    describe('bitToBoolean additional tests', () => {
      // bitToBoolean tests
    });

    describe('createEnhancedDispatch additional tests', () => {
      // createEnhancedDispatch tests    
    });

    describe('genericLoadReducer additional tests', () => {
      const initialState = {some: 'state'};

      it('should update the state for a newMeasurementLoad action type', () => {
        const action = {
          type: 'newMeasurementLoad',
          payload: {
            newMeasurementLoad: {
              data: 'newMeasurement',
              some: 'state'
            }
          }
        };

        const newState = genericLoadReducer(initialState, action);
        expect(newState).toEqual({some: 'state'});
      });
    });
  });
  describe('genericLoadContextReducer', () => {
    const initialState = null;
    const listContext = [{data: 'plot'}, {data: 'census'}, {data: 'quadrat'}, {data: 'site'}];
    const validationFunction = (list: any[], item: { data: any; }) => list.some((listItem: {
      data: any;
    }) => listItem.data === item.data);

    it('should return null for unrecognized action type', () => {
      const action = {type: 'unknown', payload: {unknown: {data: 'newData'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toBeNull();
    });

    it('should return current state if payload is null', () => {
      const action = {type: 'plot', payload: {}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toBe(initialState);
    });

    it('should return current state if action type is not a key in payload', () => {
      const action = {type: 'plot', payload: {census: {data: 'newData'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toBe(initialState);
    });

    it('should return null if item is null', () => {
      const action = {type: 'plot', payload: {plot: null}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toBeNull();
    });

    it('should return current state if item does not pass validation', () => {
      const action = {type: 'plot', payload: {plot: {data: 'nonexistent'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext, validationFunction);
      expect(newState).toBe(initialState);
    });

    it('should return item if it passes validation', () => {
      const action = {type: 'plot', payload: {plot: {data: 'plot'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext, validationFunction);
      expect(newState).toEqual({data: 'plot'});
    });

    it('should return item if it is in the list context without validation', () => {
      const action = {type: 'census', payload: {census: {data: 'census'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toEqual({data: 'census'});
    });

    it('should return current state if item is not in the list context and no validation is provided', () => {
      const action = {type: 'census', payload: {census: {data: 'nonexistent'}}};
      const newState = genericLoadContextReducer(initialState, action, listContext);
      expect(newState).toBe(initialState);
    });
  });
});
describe('getContainerClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {...originalEnv};
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw an error if AZURE_STORAGE_CONNECTION_STRING is not set', async () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = '';
    const {getContainerClient} = require('@/config/macros');
    await expect(getContainerClient('testContainer')).rejects.toThrow("process envs failed");
  });

  it('should log connection string and container name', async () => {
    console.log = jest.fn();
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testAccount;AccountKey=testKey;';
    const {getContainerClient} = require('@/config/macros');
    await getContainerClient('testContainer');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Connection String:'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('container name: testContainer'));
  });

  it('should error if blob service client creation failed', async () => {
    console.error = jest.fn();
    jest.doMock('@azure/storage-blob', () => ({
      BlobServiceClient: {
        fromConnectionString: () => null,
      },
    }));
    const {getContainerClient} = require('@/config/macros');
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testAccount;AccountKey=testKey;';
    await expect(getContainerClient('testContainer')).rejects.toThrow();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('blob service client creation failed'));
  });

  it('should log success if blob service client created & connected', async () => {
    console.error = jest.fn();
    jest.doMock('@azure/storage-blob', () => ({
      BlobServiceClient: {
        fromConnectionString: () => ({
          getContainerClient: () => ({
            createIfNotExists: () => true,
            url: 'http://example.com/testContainer',
          }),
        }),
      },
    }));
    const {getContainerClient} = require('@/config/macros');
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testAccount;AccountKey=testKey;';
    await getContainerClient('testContainer');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('blob service client created & connected'));
  });

  it('should return container client if container exists or is created successfully', async () => {
    jest.doMock('@azure/storage-blob', () => ({
      BlobServiceClient: {
        fromConnectionString: () => ({
          getContainerClient: () => ({
            createIfNotExists: () => true,
            url: 'http://example.com/testContainer',
          }),
        }),
      },
    }));
    const {getContainerClient} = require('@/config/macros');
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testAccount;AccountKey=testKey;';
    const containerClient = await getContainerClient('testContainer');
    expect(containerClient).toBeDefined();
    expect(containerClient.url).toBe('http://example.com/testContainer');
  });
});
describe('uploadValidFileAsBuffer', () => {
  const mockContainerClient = {
    getBlockBlobClient: jest.fn().mockImplementation((fileName) => ({
      uploadData: jest.fn().mockResolvedValue(true),
      exists: jest.fn().mockResolvedValue(false)
    }))
  };

  const mockFile = new File(["content"], "test.txt", {
    type: "text/plain",
  });

  const user = "testUser";
  const formType = "testForm";
  const fileRowErrors = [{row: 1, error: "Sample error"}];

  it('should upload a file without errors', async () => {
    const mockContainerClient = {
      getBlockBlobClient: jest.fn().mockImplementation((fileName) => ({
        uploadData: jest.fn().mockResolvedValue(true),
        exists: jest.fn().mockResolvedValue(false),
        url: `https://example.com/${fileName}`
      }))
    };

    jest.mock('@azure/storage-blob', () => ({
      ContainerClient: jest.fn().mockImplementation(() => mockContainerClient)
    }));

    const {uploadValidFileAsBuffer} = require('@/config/macros');

    const mockFile = new File(["content"], "test.txt", {
      type: "text/plain",
    });

    const user = "testUser";
    const formType = "testForm";

    const response = await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType);
    expect(response).toBeTruthy();
    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(mockFile.name);
  });

  it('should correctly handle file name increment on conflict', async () => {
    const mockContainerClient = {
      getBlockBlobClient: jest.fn().mockImplementationOnce((fileName) => ({
        exists: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
        uploadData: jest.fn().mockResolvedValue(true),
        url: `https://example.com/${fileName}`
      }))
    };

    jest.mock('@azure/storage-blob', () => ({
      ContainerClient: jest.fn().mockImplementation(() => mockContainerClient)
    }));

    const {uploadValidFileAsBuffer} = require('@/config/macros');

    const response = await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType);
    expect(response).toBeTruthy();
    expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith("test_1.txt");
  });

  it('should retry upload on failure and succeed', async () => {
    let attempt = 0;
    const mockBlockBlobClient = {
      uploadData: jest.fn().mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error("Upload failed");
        } else {
          return Promise.resolve(true);
        }
      }),
      exists: jest.fn().mockResolvedValue(false)
    };
    const mockContainerClient = {
      getBlockBlobClient: jest.fn().mockReturnValueOnce(mockBlockBlobClient)
    };

    const {uploadValidFileAsBuffer} = require('@/config/macros');

    const response = await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType);
    expect(response).toBeTruthy();
    expect(attempt).toBe(3);
  });

  it('should throw error after max retries exceeded', async () => {
    const mockBlockBlobClient = {
      uploadData: jest.fn().mockRejectedValue(new Error("Upload failed")),
      exists: jest.fn().mockResolvedValue(false)
    };
    const mockContainerClient = new ContainerClient('https://example.com/container');
    mockContainerClient.getBlockBlobClient = jest.fn().mockReturnValueOnce(mockBlockBlobClient);

    await expect(uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType)).rejects.toThrow("Upload failed");
  });

  describe('uploadValidFileAsBuffer additional tests', () => {
    it('should call getBlockBlobClient with the correct parameters', async () => {
      const mockUploadData = jest.fn().mockResolvedValue(true);
      const mockBlockBlobClient = {
        uploadData: mockUploadData,
        exists: jest.fn().mockResolvedValue(true) // Changed to true to test existing file scenario
      };
      const mockContainerClient = new ContainerClient('https://example.com/container');
      mockContainerClient.getBlockBlobClient = jest.fn().mockReturnValueOnce(mockBlockBlobClient)

      const fileRowErrors: { row: number, error: string, stemtag: string, tag: string, validationErrorID: number }[] = [
        {row: 1, error: 'Error message', stemtag: 'stemtag', tag: 'tag', validationErrorID: 1}
      ];

      await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType, fileRowErrors);
      expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(expect.any(String));
    });

    it('should not upload file if it already exists', async () => {
      const mockUploadData = jest.fn().mockResolvedValue(true);
      const mockBlockBlobClient = {
        uploadData: mockUploadData,
        exists: jest.fn().mockResolvedValue(true) // Simulating that the file already exists
      };
      const mockContainerClient = new ContainerClient('https://example.com/container');
      mockContainerClient.getBlockBlobClient = jest.fn().mockReturnValueOnce(mockBlockBlobClient)

      const fileRowErrors: { row: number, error: string, stemtag: string, tag: string, validationErrorID: number }[] = [
        {row: 1, error: 'Error message', stemtag: 'stemtag', tag: 'tag', validationErrorID: 1}
      ];

      await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType, fileRowErrors);
      expect(mockUploadData).not.toHaveBeenCalled();
    });

    it('should throw an error if uploadData fails', async () => {
      const mockUploadData = jest.fn().mockRejectedValue(new Error('Upload failed'));
      const mockBlockBlobClient = {
        uploadData: mockUploadData,
        exists: jest.fn().mockResolvedValue(false)
      };
      const mockContainerClient = new ContainerClient('https://example.com/container');
      mockContainerClient.getBlockBlobClient = jest.fn().mockReturnValueOnce(mockBlockBlobClient)

      const fileRowErrors: { row: number, error: string, stemtag: string, tag: string, validationErrorID: number }[] = [
        {row: 1, error: 'Error message', stemtag: 'stemtag', tag: 'tag', validationErrorID: 1}
      ];

      await expect(uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType, fileRowErrors)).rejects.toThrow('Upload failed');
    });

    it('should correctly handle empty fileRowErrors', async () => {
      const mockUploadData = jest.fn().mockResolvedValue(true);
      const mockBlockBlobClient = {
        uploadData: mockUploadData,
        exists: jest.fn().mockResolvedValue(false)
      };
      const mockContainerClient = new ContainerClient('https://example.com/container');
      mockContainerClient.getBlockBlobClient = jest.fn().mockReturnValueOnce(mockBlockBlobClient)

      const emptyFileRowErrors: FileRowErrors[] | undefined = [];

      await uploadValidFileAsBuffer(mockContainerClient, mockFile, user, formType, emptyFileRowErrors);
      expect(mockUploadData).toHaveBeenCalledWith(expect.anything(), {
        metadata: {
          user: user,
          FormType: formType,
          FileErrorState: JSON.stringify(emptyFileRowErrors)
        }
      });
    });
  })
});
describe('formatDate', () => {
  it('should correctly format an ISO date string to a readable date', () => {
    const isoDateString = '2023-04-01';
    const expectedDate = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(new Date(isoDateString));
    expect(formatDate(isoDateString)).toBe(expectedDate);
  });

  it('should handle leap years correctly', () => {
    const isoDateString = '2020-02-29';
    const expectedDate = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(new Date(isoDateString));
    expect(formatDate(isoDateString)).toBe(expectedDate);
  });

  it('should return "Invalid Date" for invalid ISO date strings', () => {
    const isoDateString = 'not-a-date';
    expect(formatDate(isoDateString)).toBe('Invalid Date');
  });

  it('should work with different locales', () => {
    const isoDateString = '2023-04-01';
    const expectedDate = new Intl.DateTimeFormat('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(new Date(isoDateString));
    const originalLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    Intl.DateTimeFormat = jest.fn().mockImplementation(() => {
      return {
        format: () => expectedDate,
        resolvedOptions: () => {
          return {locale: 'fr-FR'};
        },
        supportedLocalesOf: () => ['fr-FR']
      };
    }) as any;
    expect(formatDate(isoDateString)).toBe(expectedDate);
    Intl.DateTimeFormat = jest.fn().mockImplementation(() => {
      return {
        format: () => 'mocked',
        resolvedOptions: () => {
          return {locale: originalLocale};
        },
        supportedLocalesOf: () => [originalLocale]
      };
    }) as any;
  });
});

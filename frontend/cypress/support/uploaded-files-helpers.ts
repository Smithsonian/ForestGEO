interface UploadedFileRecord {
  key?: number;
  name: string;
  user: string;
  date: string;
  formType: string;
  fileErrors: string | number;
}

interface DeleteUploadedFileResult {
  statusCode?: number;
  body?: Record<string, unknown>;
  files?: UploadedFileRecord[];
}

interface MockUploadedFilesApiOptions {
  files: UploadedFileRecord[];
  downloadUrlBuilder?: (filename: string) => string;
  deleteHandler?: (filename: string, files: UploadedFileRecord[]) => DeleteUploadedFileResult | void;
}

function cloneFiles(files: UploadedFileRecord[]) {
  return files.map(file => ({ ...file }));
}

function withSequentialKeys(files: UploadedFileRecord[]) {
  return files.map((file, index) => ({
    ...file,
    key: index + 1
  }));
}

export function buildUploadedFile(overrides: Partial<UploadedFileRecord> = {}): UploadedFileRecord {
  const name = overrides.name ?? 'measurements-2024-06-15.csv';

  return {
    key: overrides.key,
    name,
    user: overrides.user ?? 'Field Crew',
    date: overrides.date ?? '2024-06-15T09:30:00.000Z',
    formType: overrides.formType ?? (name.toLowerCase().endsWith('.xlsx') ? 'arcgis_xlsx' : 'measurements'),
    fileErrors: overrides.fileErrors ?? 0
  };
}

export function mockUploadedFilesApi({
  files,
  downloadUrlBuilder = filename => `/measurementshub/uploadedfiles#download-${encodeURIComponent(filename)}`,
  deleteHandler
}: MockUploadedFilesApiOptions) {
  const state = {
    files: cloneFiles(files)
  };

  cy.intercept('GET', '**/api/files/list?*', req => {
    req.reply({
      statusCode: 200,
      body: {
        blobData: withSequentialKeys(state.files)
      }
    });
  }).as('fetchUploadedFiles');

  cy.intercept('GET', '**/api/files/download?*', req => {
    const url = new URL(req.url);
    const filename = url.searchParams.get('filename') ?? '';

    req.reply({
      statusCode: 200,
      body: {
        url: downloadUrlBuilder(filename)
      }
    });
  }).as('downloadUploadedFile');

  cy.intercept('DELETE', '**/api/files/delete?*', req => {
    const url = new URL(req.url);
    const filename = url.searchParams.get('filename') ?? '';
    const result = deleteHandler?.(filename, cloneFiles(state.files));
    const statusCode = result?.statusCode ?? 200;

    if (result?.files) {
      state.files = cloneFiles(result.files);
    } else if (statusCode < 400) {
      state.files = state.files.filter(file => file.name !== filename);
    }

    req.reply({
      statusCode,
      body:
        result?.body ??
        (statusCode < 400
          ? {
              success: true
            }
          : {
              error: `Failed to delete ${filename}`
            })
    });
  }).as('deleteUploadedFile');

  return state;
}

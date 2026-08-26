/**
 * UploadParent Component - Hook Integration Tests
 *
 * Tests the refactored UploadParent component with custom hooks:
 * - useFileManagement
 * - useUploadState
 * - useErrorHandling
 *
 * Verifies integration between hooks and component logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadParent from './uploadparent';
import { FormType } from '@/config/macros/formdetails';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { UploadMode } from '@/config/uploadmodes';
import React from 'react';

// Mock AttributeStatusOptions and HC functions
vi.mock('@/lib/db/definitions/core', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    AttributeStatusOptions: ['alive', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'],
    getFailedMeasurementsHCs: () => ({
      failedMeasurementID: false,
      plotID: false,
      censusID: false
    }),
    getCoreMeasurementsHCs: () => ({
      censusID: false,
      stemGUID: false,
      description: false
    })
  };
});

// Mock views HC functions
vi.mock('@/lib/db/definitions/views', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAllViewFullTableViewsHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false,
      familyID: false,
      genusID: false
    }),
    getMeasurementsSummaryViewHCs: () => ({
      coreMeasurementID: false,
      plotID: false,
      censusID: false,
      quadratID: false,
      speciesID: false,
      treeID: false,
      stemGUID: false,
      personnelID: false
    }),
    getAllTaxonomiesViewHCs: () => ({
      speciesID: false,
      familyID: false,
      genusID: false
    })
  };
});

// Mock personnel HC functions
vi.mock('@/lib/db/definitions/personnel', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getPersonnelHCs: () => ({
      censusID: false,
      personnelID: false
    })
  };
});

// Mock zones HC functions
vi.mock('@/lib/db/definitions/zones', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getQuadratHCs: () => ({
      quadratID: false,
      plotID: false,
      censusID: false
    })
  };
});

// Mock taxonomies HC functions
vi.mock('@/lib/db/definitions/taxonomies', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSpeciesLimitsHCs: () => ({
      speciesLimitsID: false,
      speciesID: false
    })
  };
});

// Mock next-auth
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Test User', email: 'test@example.com' } },
    status: 'authenticated'
  })
}));

// Mock user selection context
vi.mock('@/app/contexts/userselectionprovider', () => ({
  useOrgCensusContext: () => ({ censusID: 1, plotCensusNumber: 1 }),
  usePlotContext: () => ({ plotID: 1, plotName: 'Test Plot' }),
  useSiteContext: () => ({ schemaName: 'forestgeo_testing', siteName: 'Test Site' })
}));

// Mock AI logger
vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

// Mock ContextValidationGuard to just render children
vi.mock('@/components/shared/ContextValidationGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

// UploadParent gates UPLOAD_SQL behind a live feature-flag fetch
// (`/api/features/async-upload`). That flag is irrelevant to these hook-integration
// tests, and leaving it un-mocked makes every UPLOAD_SQL-reaching test depend on the
// global fetch queue in tests/mocks/auth-mocks.ts having a response staged. Pin it to
// disabled so every test deterministically renders UploadFireSQL (mocked below).
vi.mock('@/app/hooks/useasyncuploadfeature', () => ({
  useAsyncUploadFeature: () => false
}));

// Mock upload segment components
vi.mock('@/components/uploadsystem/segments/uploadstart', () => ({
  default: ({ uploadForm, setUploadForm, setReviewState, personnelRecording, setPersonnelRecording }: any) => (
    <div data-testid="upload-start">
      <button
        onClick={() => {
          setUploadForm(FormType.measurements);
          setPersonnelRecording('Test Personnel');
        }}
      >
        Select Measurements
      </button>
      {/* Mirrors the real UploadStart: selecting a form and finalizing are separate
          steps (see FinalizeSelectionsButton in uploadstart.tsx), and only finalizing
          advances reviewState to UPLOAD_FILES. */}
      <button onClick={() => setReviewState(ReviewStates.UPLOAD_FILES)}>Finalize Selection</button>
      <span data-testid="upload-form-value">{uploadForm || 'none'}</span>
      <span data-testid="personnel-value">{personnelRecording || 'none'}</span>
    </div>
  )
}));

vi.mock('@/components/uploadsystem/segments/uploadparsefiles', () => ({
  default: ({ uploadForm, acceptedFiles, handleAddFile, handleRemoveFile, handleReplaceFile: _handleReplaceFile, handleInitialSubmit }: any) => (
    <div data-testid="upload-parse-files">
      <div data-testid="upload-parse-files-form-value">{uploadForm || 'none'}</div>
      <div data-testid="file-count">{acceptedFiles.length}</div>
      {acceptedFiles.map((file: any, index: number) => (
        <div key={index} data-testid={`file-${index}`}>
          {file.name}
          <button onClick={() => handleRemoveFile(index)}>Remove</button>
        </div>
      ))}
      <button
        onClick={() => {
          // A real File (not a plain object) so that revision-mode's parseRevisionFiles,
          // which runs Papa.parse over the file's content via jsdom's FileReader, has
          // something to actually read. Non-revision tests only ever assert on
          // file.name/file count, so this content is inert for them.
          const mockFile = new File(['tag,stemtag,quadrat,dbh,date\nT001,S1,Q1,10,2024-01-01\n'], 'test.csv', { type: 'text/csv' });
          Object.assign(mockFile, { path: '/test.csv' });
          handleAddFile(mockFile as any);
        }}
      >
        Add File
      </button>
      <button onClick={() => handleInitialSubmit()}>Continue Upload</button>
    </div>
  )
}));

// Shared, test-controlled behavior for the UploadFireSQL mock. `vi.hoisted` is required
// because `vi.mock` factories are hoisted above the rest of the module: a plain
// module-scope `const` referenced inside the factory below would still be in its
// temporal dead zone when the factory actually runs.
const { mockUploadFireSqlBehavior } = vi.hoisted(() => ({
  mockUploadFireSqlBehavior: {
    mode: 'complete' as 'complete' | 'error',
    errorMessage: 'Upload failed',
    errorComponent: 'UploadFireSQL'
  }
}));

vi.mock('@/components/uploadsystem/segments/uploadfiresql', () => {
  const MockUploadFireSQL = ({ acceptedFiles, personnelRecording, setReviewState, setUploadError, setErrorComponent }: any) => {
    React.useEffect(() => {
      if (mockUploadFireSqlBehavior.mode === 'error') {
        // Mirrors the real UploadFireSQL: every error path pairs setUploadError with
        // setReviewState(ERRORS) -- neither ever fires alone in production.
        setUploadError(new Error(mockUploadFireSqlBehavior.errorMessage));
        setErrorComponent(mockUploadFireSqlBehavior.errorComponent);
        setReviewState(ReviewStates.ERRORS);
        return;
      }

      const timer = setTimeout(() => setReviewState(ReviewStates.COMPLETE), 100);
      return () => clearTimeout(timer);
    }, [setReviewState, setUploadError, setErrorComponent]);

    return (
      <div data-testid="upload-fire-sql">
        <div>Processing {acceptedFiles.length} files</div>
        <div>Personnel: {personnelRecording}</div>
      </div>
    );
  };
  return { default: MockUploadFireSQL };
});

vi.mock('@/components/uploadsystem/segments/uploaderror', () => ({
  default: ({ error, component, resetError, handleReturnToStart }: any) => (
    <div data-testid="upload-error">
      <div data-testid="error-message">{error?.message || 'Unknown error'}</div>
      <div data-testid="error-component">{component}</div>
      <button onClick={() => resetError()}>Clear Error</button>
      <button onClick={() => handleReturnToStart()}>Return to Start</button>
    </div>
  )
}));

vi.mock('@/components/uploadsystem/segments/uploadcomplete', () => ({
  default: ({ handleCloseUploadModal }: any) => (
    <div data-testid="upload-complete">
      <div>Upload Complete!</div>
      <button onClick={() => handleCloseUploadModal()}>Close</button>
    </div>
  )
}));

vi.mock('@/components/uploadsystem/segments/uploadvalidation', () => ({
  default: () => <div data-testid="upload-validation">Validation</div>
}));

vi.mock('@/components/uploadsystem/segments/uploadupdatevalidations', () => ({
  default: () => <div data-testid="upload-update-validations">Update Validations</div>
}));

vi.mock('@/components/uploadsystem/segments/uploadfireazure', () => ({
  default: () => <div data-testid="upload-fire-azure">Fire Azure</div>
}));

vi.mock('@/components/uploadsystem/segments/uploadreingestion', () => ({
  default: () => <div data-testid="upload-reingestion">Reingestion</div>
}));

describe('UploadParent - Hook Integration Tests', () => {
  const mockOnReset = vi.fn();
  const mockOnUploadComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFireSqlBehavior.mode = 'complete';
    mockUploadFireSqlBehavior.errorMessage = 'Upload failed';
    mockUploadFireSqlBehavior.errorComponent = 'UploadFireSQL';
  });

  describe('Hook Integration - useUploadState', () => {
    it('should initialize with correct upload form when provided', () => {
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      // When overrideUploadForm is provided, skip START and go directly to UPLOAD_FILES
      expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();

      // Prove it's specifically the provided form that was initialized, not just
      // any truthy value -- useUploadState.getInitialReviewState() skips START for
      // any defined overrideUploadForm, so asserting presence alone would pass even
      // if the wrong form type were threaded through.
      expect(screen.getByTestId('upload-parse-files-form-value')).toHaveTextContent(FormType.measurements);
    });

    it('should start at START state when no overrideUploadForm', async () => {
      const user = userEvent.setup();

      render(<UploadParent onReset={mockOnReset} />);

      // START state - upload-start should be rendered
      expect(screen.getByTestId('upload-start')).toBeInTheDocument();
      expect(screen.getByTestId('personnel-value')).toHaveTextContent('none');

      // Set personnel via hook
      await user.click(screen.getByText('Select Measurements'));

      // useUploadState.setPersonnelRecording should update state
      expect(screen.getByTestId('personnel-value')).toHaveTextContent('Test Personnel');
    });

    it('should transition through review states from START', async () => {
      const user = userEvent.setup();

      render(<UploadParent onReset={mockOnReset} onUploadComplete={mockOnUploadComplete} />);

      // START state - no overrideUploadForm
      expect(screen.getByTestId('upload-start')).toBeInTheDocument();

      // Select the form, then finalize (mirrors the real two-step UploadStart flow)
      await user.click(screen.getByText('Select Measurements'));
      await user.click(screen.getByText('Finalize Selection'));

      // Should have transitioned to UPLOAD_FILES
      await waitFor(() => {
        expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();
      });

      // Add file and progress
      await user.click(screen.getByText('Add File'));
      await user.click(screen.getByText('Continue Upload'));

      // Should transition to UPLOAD_SQL
      await waitFor(() => {
        expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument();
      });

      // Should eventually reach COMPLETE
      await waitFor(
        () => {
          expect(screen.getByTestId('upload-complete')).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // onUploadComplete callback should be called
      expect(mockOnUploadComplete).toHaveBeenCalled();
    });
  });

  describe('Hook Integration - useFileManagement', () => {
    it('should add files via useFileManagement.addFile', async () => {
      const user = userEvent.setup();

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      // Initial file count should be 0
      expect(screen.getByTestId('file-count')).toHaveTextContent('0');

      // Add file
      await user.click(screen.getByText('Add File'));

      // useFileManagement.addFile should update files array
      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('1');
      });

      expect(screen.getByTestId('file-0')).toHaveTextContent('test.csv');
    });

    it('should remove files via useFileManagement.removeFile', async () => {
      const user = userEvent.setup();

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      // Add two files
      await user.click(screen.getByText('Add File'));
      await user.click(screen.getByText('Add File'));

      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('2');
      });

      // Remove first file
      const removeButtons = screen.getAllByText('Remove');
      await user.click(removeButtons[0]);

      // useFileManagement.removeFile should update files array
      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('1');
      });
    });

    it('should clear all files when returning to start', async () => {
      const user = userEvent.setup();
      mockUploadFireSqlBehavior.mode = 'error';

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      await user.click(screen.getByText('Add File'));
      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('1');
      });

      // Drive into the error state, then use handleReturnToStart -- the same
      // production callback UploadError and UploadRevisionMatch use to reset the
      // workflow -- to exercise useFileManagement.clearFiles.
      await user.click(screen.getByText('Continue Upload'));
      await waitFor(() => {
        expect(screen.getByTestId('upload-error')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Return to Start'));

      await waitFor(() => {
        expect(screen.getByTestId('upload-start')).toBeInTheDocument();
      });

      // Re-select the form and confirm the file list came back empty, proving
      // clearFiles ran rather than merely resetting reviewState.
      await user.click(screen.getByText('Select Measurements'));
      await user.click(screen.getByText('Finalize Selection'));

      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('0');
      });
    });
  });

  describe('Hook Integration - useErrorHandling', () => {
    it('should handle errors via useErrorHandling.setError', async () => {
      mockUploadFireSqlBehavior.mode = 'error';

      const user = userEvent.setup();

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      await user.click(screen.getByText('Add File'));
      await user.click(screen.getByText('Continue Upload'));

      // Should show error component
      await waitFor(() => {
        expect(screen.getByTestId('upload-error')).toBeInTheDocument();
      });

      // Error details from useErrorHandling
      expect(screen.getByTestId('error-message')).toHaveTextContent('Upload failed');
      expect(screen.getByTestId('error-component')).toHaveTextContent('UploadFireSQL');
    });

    it('should clear errors via useErrorHandling.clearError', async () => {
      mockUploadFireSqlBehavior.mode = 'error';
      mockUploadFireSqlBehavior.errorMessage = 'Test error';

      const user = userEvent.setup();

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      await user.click(screen.getByText('Add File'));
      await user.click(screen.getByText('Continue Upload'));

      await waitFor(() => {
        expect(screen.getByTestId('upload-error')).toBeInTheDocument();
      });
      expect(screen.getByTestId('error-message')).toHaveTextContent('Test error');

      // Clear error
      await user.click(screen.getByText('Clear Error'));

      // useErrorHandling.clearError should null out the error; UploadError's mocked
      // fallback text proves the cleared state actually reached the component.
      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toHaveTextContent('Unknown error');
      });
    });
  });

  describe('State Management - Complex Workflows', () => {
    it('should handle complete upload workflow with all hooks', async () => {
      const user = userEvent.setup();

      // With overrideUploadForm, we skip START and go directly to UPLOAD_FILES
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} onUploadComplete={mockOnUploadComplete} />);

      // 1. Add file (useFileManagement) - already at UPLOAD_FILES state
      await user.click(screen.getByText('Add File'));
      await waitFor(() => {
        expect(screen.getByTestId('file-count')).toHaveTextContent('1');
      });

      // 2. Start upload (useUploadState.setReviewState)
      await user.click(screen.getByText('Continue Upload'));

      // 3. Process (useUploadState manages state transitions)
      await waitFor(() => {
        expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument();
      });

      // 4. Complete (useUploadState.isComplete)
      await waitFor(
        () => {
          expect(screen.getByTestId('upload-complete')).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Verify all hooks worked together
      expect(mockOnUploadComplete).toHaveBeenCalledTimes(1);
    });

    it('should skip to processing when skipToProcessing flag is set', async () => {
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} skipToProcessing={true} />);

      // skipToProcessing routes UPLOAD_SQL through the reingestion segment instead of
      // the normal file-upload segment (see the reingestion-init effect in
      // uploadparent.tsx), bypassing START and UPLOAD_FILES entirely.
      await waitFor(() => {
        expect(screen.getByTestId('upload-reingestion')).toBeInTheDocument();
      });
    });
  });
});

describe('UploadParent - Revision Upload Default Tab Selection', () => {
  const mockOnReset = vi.fn();

  // /api/revisionupload and /api/revisionupload/apply are real, unmocked routes here --
  // UploadRevisionMatch and UploadRevisionApply are NOT mocked above, so this exercises
  // the actual review + apply UI, not a stand-in. Only fetch is intercepted.
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  interface MockRevisionFetchOptions {
    matchResponse: unknown;
    applyResponse?: unknown;
    /** Hold the match response until resolveMatch() is called, to observe the interstitial loading state. */
    deferMatch?: boolean;
  }

  function mockRevisionUploadFetch(options: MockRevisionFetchOptions) {
    const applyRequestBodies: Array<Record<string, unknown>> = [];
    let releaseMatch: (() => void) | undefined;
    const matchReady = options.deferMatch
      ? new Promise<void>(resolve => {
          releaseMatch = resolve;
        })
      : Promise.resolve();

    const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });

    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url === '/api/revisionupload/apply') {
        applyRequestBodies.push(init?.body ? JSON.parse(init.body as string) : {});
        return jsonResponse(options.applyResponse ?? {});
      }

      if (url === '/api/revisionupload') {
        await matchReady;
        return jsonResponse(options.matchResponse);
      }

      throw new Error(`Unexpected fetch call to ${url} in revision upload test`);
    });

    global.fetch = impl as unknown as typeof global.fetch;

    return { applyRequestBodies, resolveMatch: () => releaseMatch?.() };
  }

  async function driveToRevisionMatch(user: ReturnType<typeof userEvent.setup>) {
    render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} overrideUploadMode={UploadMode.REVISIONS} />);

    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));

    await user.click(screen.getByText('Continue Upload'));
  }

  it('opens on the New Rows tab for a new-only revision upload, and requires explicit confirmation before applying', async () => {
    const user = userEvent.setup();

    const newRowCsvRow = { tag: 'T001', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01', spcode: null };
    const matchResponse = {
      matchedRows: [],
      newRows: [{ csvRow: newRowCsvRow, csvIndex: 0, reason: 'no-match-key-in-db' }],
      invalidRows: [],
      counts: { matched: 0, matchedWithChanges: 0, new: 1, invalid: 0, total: 1 }
    };
    const applyResponse = {
      updatedCount: 0,
      skippedCount: 0,
      insertedCount: 1,
      deletedDuplicateCount: 0,
      applyErrors: [],
      validationPending: false
    };
    const { applyRequestBodies, resolveMatch } = mockRevisionUploadFetch({ matchResponse, applyResponse, deferMatch: true });

    await driveToRevisionMatch(user);

    // UploadRevisionMatch must not mount until the match response exists -- while the
    // request is in flight, a matching-in-progress state should be visible instead.
    await waitFor(() => expect(screen.getByText(/matching revision rows/i)).toBeInTheDocument());
    expect(screen.queryByText('Confirm new row insertion')).not.toBeInTheDocument();

    resolveMatch();

    // This is the defect under test: UploadRevisionMatch used to mount with `?? []`
    // empties before the match response existed, and MUI Joy's Tabs reads
    // defaultValue only once (it is uncontrolled). With every count at zero on that
    // first render, the tab-selection ternary (and now resolveDefaultTabValue) both
    // land on 'changes' -- which locks the Tabs selection there permanently. Once the
    // real newRows-only response lands, the New Rows tab exists in the TabList but its
    // panel is never the selected one, so this text never renders and the wait below
    // times out.
    await waitFor(() => expect(screen.getByText('Confirm new row insertion')).toBeInTheDocument(), { timeout: 3000 });

    const applyButton = screen.getByTestId('revision-match-apply');
    expect(applyButton).toBeDisabled();

    await user.click(screen.getByText('Confirm new row insertion'));
    expect(applyButton).not.toBeDisabled();

    await user.click(applyButton);

    await waitFor(() => expect(applyRequestBodies).toHaveLength(1));
    expect(applyRequestBodies[0].confirmNewRows).toBe(true);
    expect(applyRequestBodies[0].newRows).toHaveLength(1);

    await waitFor(() => expect(screen.getByText('Revisions Applied')).toBeInTheDocument());
  });

  it('opens on the Invalid tab for an invalid-only revision upload, and keeps Apply disabled', async () => {
    const user = userEvent.setup();

    const invalidCsvRow = { tag: 'T404', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01' };
    const matchResponse = {
      matchedRows: [],
      newRows: [],
      invalidRows: [{ csvRow: invalidCsvRow, csvIndex: 0, reason: 'No matching identity found in the active census' }],
      counts: { matched: 0, matchedWithChanges: 0, new: 0, invalid: 1, total: 1 }
    };
    mockRevisionUploadFetch({ matchResponse });

    await driveToRevisionMatch(user);

    // The Invalid tab has no intro copy of its own -- its row-level reason text is the
    // signal that its panel (not Changes) is the one actually selected.
    await waitFor(() => expect(screen.getByText('No matching identity found in the active census')).toBeInTheDocument(), { timeout: 3000 });
    // MUI Joy's TabPanel omits its children entirely (not just CSS-hides them) when
    // it isn't the selected tab, so the Changes panel's empty-state copy shouldn't
    // exist in the DOM at all if Changes is not the tab that ended up selected.
    expect(screen.queryByText('No rows with changes were found.')).not.toBeInTheDocument();

    expect(screen.getByTestId('revision-match-apply')).toBeDisabled();
  });

  it('opens on the Unchanged tab for an unchanged-only revision upload, and keeps Apply disabled', async () => {
    const user = userEvent.setup();

    const unchangedCsvRow = { tag: 'T900', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01' };
    const matchResponse = {
      matchedRows: [
        {
          csvIndex: 0,
          csvRow: unchangedCsvRow,
          coreMeasurementID: 900,
          changes: {},
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: '2024-01-01', rawCodes: null, description: null }
        }
      ],
      newRows: [],
      invalidRows: [],
      counts: { matched: 1, matchedWithChanges: 0, new: 0, invalid: 0, total: 1 }
    };
    mockRevisionUploadFetch({ matchResponse });

    await driveToRevisionMatch(user);

    await waitFor(() => expect(screen.getByText('1 matched row had no field differences and will be skipped during apply.')).toBeInTheDocument(), {
      timeout: 3000
    });
    // MUI Joy's TabPanel omits its children entirely (not just CSS-hides them) when
    // it isn't the selected tab, so the Changes panel's empty-state copy shouldn't
    // exist in the DOM at all if Changes is not the tab that ended up selected.
    expect(screen.queryByText('No rows with changes were found.')).not.toBeInTheDocument();

    expect(screen.getByTestId('revision-match-apply')).toBeDisabled();
  });
});

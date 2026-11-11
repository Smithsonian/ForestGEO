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
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadParent, { mergeFreshRevisionPlan } from './uploadparent';
import { FormType, SourceFormat } from '@/config/macros/formdetails';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { UploadMode } from '@/config/uploadmodes';
import { RevisionUploadResponse } from '@/config/revisionuploadtypes';
import { BulkEditPlan } from '@/config/editplan/types';
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

// uploadparent.tsx actually reads context via '@/app/contexts/compat-hooks' (the
// userselectionprovider mock above is unused by it but left in place for other
// potential consumers). Mutable so the replacement-confirmation describe block below
// can exercise real schema/plot/census values; every other describe block in this
// file is unaffected since its new gate only activates for an explicit
// UploadMode.CLEAN_REUPLOAD measurements upload, which none of them set.
let compatCensusValue: any = { plotCensusNumber: 1, dateRanges: [{ censusID: 1 }] };
let compatPlotValue: any = { plotID: 1, plotName: 'Test Plot' };
let compatSiteValue: any = { schemaName: 'forestgeo_testing', siteName: 'Test Site' };
vi.mock('@/app/contexts/compat-hooks', () => ({
  useOrgCensusContext: () => compatCensusValue,
  usePlotContext: () => compatPlotValue,
  useSiteContext: () => compatSiteValue
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
  default: ({ uploadForm, setUploadForm, setUploadMode, setReviewState, personnelRecording, setPersonnelRecording }: any) => (
    <div data-testid="upload-start">
      <button
        onClick={() => {
          setUploadForm(FormType.measurements);
          setPersonnelRecording('Test Personnel');
        }}
      >
        Select Measurements
      </button>
      {/* Only exercised by the cross-upload identity-reset test below, which needs
          uploadMode restored to REVISIONS after a real resetToStart() (the reducer
          clears it) to re-enter revision mode without remounting the component. */}
      <button onClick={() => setUploadMode(UploadMode.REVISIONS)}>Select Revision Mode</button>
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
  default: ({ uploadForm, acceptedFiles, handleAddFile, handleRemoveFile, handleReplaceFile, handleInitialSubmit, dataViewActive, setDataViewActive }: any) => (
    <div data-testid="upload-parse-files">
      <div data-testid="data-view-active">{dataViewActive}</div>
      <div data-testid="selected-file-name">{acceptedFiles[dataViewActive - 1]?.name ?? 'none'}</div>
      <button onClick={() => setDataViewActive(acceptedFiles.length)}>Select Last File</button>
      <button onClick={() => setDataViewActive(2)}>Select Second File</button>
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
      <button
        onClick={() => {
          const numberedFile = new File(['tag,stemtag,quadrat,dbh,date\nT001,S1,Q1,10,2024-01-01\n'], `file-${acceptedFiles.length + 1}.csv`, {
            type: 'text/csv'
          });
          Object.assign(numberedFile, { path: `/${numberedFile.name}` });
          handleAddFile(numberedFile as any);
        }}
      >
        Add Numbered File
      </button>
      <button
        onClick={() => {
          // Issue #504: a NEW File object sharing the first file's name must still
          // invalidate a pending replacement check/confirmation -- useFileManagement
          // tracks files by array reference, not by name, so this proves the gate
          // isn't fooled by name-only comparisons.
          const first = acceptedFiles[0];
          const replacement = new File(['tag,stemtag,quadrat,dbh,date\nT002,S2,Q1,12,2024-02-02\n'], first?.name ?? 'test.csv', {
            type: 'text/csv',
            lastModified: first?.lastModified
          });
          Object.assign(replacement, { path: '/test.csv' });
          handleReplaceFile(0, replacement);
        }}
      >
        Replace First File With New Object
      </button>
      <button onClick={() => handleInitialSubmit()}>Continue Upload</button>
    </div>
  )
}));

vi.mock('@/components/uploadsystem/segments/uploadarcgispreflight', () => ({
  default: ({ onProceed }: { onProceed: (reference: { importSessionId: string; fileName: string; rowCount: number }) => void }) => (
    <div data-testid="upload-arcgis-preflight">
      <button onClick={() => onProceed({ importSessionId: 'session-1', fileName: 'workbook.xlsx', rowCount: 5 })}>Proceed with import</button>
    </div>
  )
}));

// Shared, test-controlled behavior for the UploadFireSQL mock. `vi.hoisted` is required
// because `vi.mock` factories are hoisted above the rest of the module: a plain
// module-scope `const` referenced inside the factory below would still be in its
// temporal dead zone when the factory actually runs.
const { mockUploadFireSqlBehavior, mockUploadFireAzureBehavior } = vi.hoisted(() => ({
  mockUploadFireSqlBehavior: {
    mode: 'complete' as 'complete' | 'error',
    errorMessage: 'Upload failed',
    errorComponent: 'UploadFireSQL'
  },
  mockUploadFireAzureBehavior: { advanceToComplete: false }
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
  default: ({ handleCloseUploadModal, uploadOutcome }: any) => (
    <div data-testid="upload-complete">
      <div>Upload Complete!</div>
      <div data-testid="upload-complete-outcome">{JSON.stringify(uploadOutcome ?? null)}</div>
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

vi.mock('@/components/uploadsystem/segments/uploadfireazure', () => {
  const MockUploadFireAzure = ({ setReviewState }: any) => {
    React.useEffect(() => {
      if (mockUploadFireAzureBehavior.advanceToComplete) setReviewState(ReviewStates.COMPLETE);
    }, [setReviewState]);
    return <div data-testid="upload-fire-azure">Fire Azure</div>;
  };
  return { default: MockUploadFireAzure };
});

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
    mockUploadFireAzureBehavior.advanceToComplete = false;
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

      // onUploadComplete fires from a passive effect that can commit after the COMPLETE markup above.
      await waitFor(() => {
        expect(mockOnUploadComplete).toHaveBeenCalledTimes(1);
      });
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

    it.each([
      ['the first file', 0],
      ['the selected last file', 1]
    ])('clamps the selected file to the remaining one after removing %s of two (#524 item 5)', async (_label, removedIndex) => {
      const user = userEvent.setup();
      const EXPECTED_SELECTED_FILE_VIEW = '1';
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      await user.click(screen.getByText('Add File'));
      await user.click(screen.getByText('Add File'));
      await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('2'));
      await user.click(screen.getByText('Select Last File'));
      expect(screen.getByTestId('data-view-active')).toHaveTextContent('2');

      await user.click(screen.getAllByText('Remove')[removedIndex]);
      await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));
      console.log(`[remove ${_label}] data-view-active=${screen.getByTestId('data-view-active').textContent}`);

      expect(screen.getByTestId('data-view-active'), 'the selected-file index must point at the one remaining file').toHaveTextContent(
        EXPECTED_SELECTED_FILE_VIEW
      );
    });

    it('keeps the same file selected when an earlier file is removed from three (#524 item 5)', async () => {
      const user = userEvent.setup();
      const SECOND_FILE_VIEW = '2';
      const FIRST_FILE_VIEW = '1';
      const SECOND_FILE_NAME = 'file-2.csv';
      render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} />);

      await user.click(screen.getByText('Add Numbered File'));
      await user.click(screen.getByText('Add Numbered File'));
      await user.click(screen.getByText('Add Numbered File'));
      await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('3'));
      await user.click(screen.getByText('Select Second File'));
      expect(screen.getByTestId('data-view-active')).toHaveTextContent(SECOND_FILE_VIEW);
      expect(screen.getByTestId('selected-file-name')).toHaveTextContent(SECOND_FILE_NAME);

      await user.click(screen.getAllByText('Remove')[0]);
      await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('2'));
      console.log(
        `[remove first of three] data-view-active=${screen.getByTestId('data-view-active').textContent} selected=${screen.getByTestId('selected-file-name').textContent}`
      );

      expect(screen.getByTestId('data-view-active'), 'the tab index must shift down with the removed earlier file').toHaveTextContent(FIRST_FILE_VIEW);
      expect(screen.getByTestId('selected-file-name'), 'the previously selected file must still be the one shown').toHaveTextContent(SECOND_FILE_NAME);
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

      // Verify all hooks worked together; onUploadComplete fires from a passive effect
      // that can commit after the COMPLETE markup above.
      await waitFor(() => {
        expect(mockOnUploadComplete).toHaveBeenCalledTimes(1);
      });
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
    mockUploadFireAzureBehavior.advanceToComplete = false;
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

  /**
   * Mocks /api/revisionupload as a request that never resolves on its own -- it only
   * settles by rejecting with the same AbortError DOMException real fetch() produces
   * when the request's signal aborts (verified against Node's real fetch: a manual
   * AbortController.abort() surfaces as `DOMException` named 'AbortError'). This lets
   * the cancel-button and unmount tests observe the abort without a real timeout.
   */
  function mockNeverSettlingRevisionMatchFetch() {
    const signals: AbortSignal[] = [];

    const impl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== '/api/revisionupload') {
        throw new Error(`Unexpected fetch call to ${url} in never-settling revision match test`);
      }

      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return;
        signals.push(signal);
        const rejectWithAbortError = () => reject(new DOMException('This operation was aborted', 'AbortError'));
        if (signal.aborted) {
          rejectWithAbortError();
          return;
        }
        signal.addEventListener('abort', rejectWithAbortError);
      });
    });

    global.fetch = impl as unknown as typeof global.fetch;
    return { signals };
  }

  // Shared by driveToRevisionMatch (first upload, fresh mount) and the
  // cross-upload identity-reset test below (second upload, same mount).
  async function addFileAndContinueUpload(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));
    await user.click(screen.getByText('Continue Upload'));
  }

  async function driveToRevisionMatch(user: ReturnType<typeof userEvent.setup>) {
    const renderResult = render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} overrideUploadMode={UploadMode.REVISIONS} />);

    await addFileAndContinueUpload(user);

    return renderResult;
  }

  it('opens on the New Rows tab for a new-only revision upload, and inserts new rows only when the box in the confirmation dialog is checked', async () => {
    const user = userEvent.setup();

    const newRowCsvRow = { tag: 'T001', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01', spcode: null };
    const matchResponse = {
      matchedRows: [],
      newRows: [{ csvRow: newRowCsvRow, csvIndex: 0, reason: 'no-match-key-in-db' }],
      invalidRows: [],
      counts: { matched: 0, matchedWithChanges: 0, new: 1, invalid: 0, total: 1 },
      bulkPlan: {
        dataType: 'measurementssummary',
        rowCount: 1,
        rowPlans: [{ rowIndex: 0, status: 'new' }],
        aggregateEffects: [],
        maxSeverity: 'info',
        planHash: 'new-only-plan-hash',
        generatedAt: '2026-10-21T00:00:00Z',
        duplicateDeletions: []
      }
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
    const NEW_ROWS_TAB_TEXT = /will be inserted as new measurements if you include them when applying/;

    await driveToRevisionMatch(user);

    // UploadRevisionMatch must not mount until the match response exists -- while the
    // request is in flight, a matching-in-progress state should be visible instead.
    await waitFor(() => expect(screen.getByText(/matching revision rows/i)).toBeInTheDocument());
    expect(screen.queryByText(NEW_ROWS_TAB_TEXT)).not.toBeInTheDocument();

    resolveMatch();

    // This is the defect under test: UploadRevisionMatch used to mount with `?? []`
    // empties before the match response existed, and MUI Joy's Tabs reads
    // defaultValue only once (it is uncontrolled). With every count at zero on that
    // first render, the tab-selection ternary (and now resolveDefaultTabValue) both
    // land on 'changes' -- which locks the Tabs selection there permanently. Once the
    // real newRows-only response lands, the New Rows tab exists in the TabList but its
    // panel is never the selected one, so this text never renders and the wait below
    // times out.
    await waitFor(() => expect(screen.getByText(NEW_ROWS_TAB_TEXT)).toBeInTheDocument(), { timeout: 3000 });

    const reviewButton = screen.getByTestId('revision-match-apply');
    expect(reviewButton).toHaveTextContent('Review and apply…');
    await user.click(reviewButton);
    const confirmButton = await screen.findByTestId('impact-summary-apply');
    expect(confirmButton).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Also insert 1 new row' }));
    expect(confirmButton).not.toBeDisabled();
    await user.click(confirmButton);

    await waitFor(() => expect(applyRequestBodies).toHaveLength(1));
    console.log(`[#525 item 9] apply body confirmNewRows=${String(applyRequestBodies[0].confirmNewRows)}`);
    expect(applyRequestBodies[0].confirmNewRows).toBe(true);
    expect(applyRequestBodies[0].newRows).toHaveLength(1);

    await waitFor(() => expect(screen.getByText('Revisions Applied')).toBeInTheDocument());
  });

  it('opens on the Invalid tab for an invalid-only revision upload, and keeps Apply enabled so the rejected row is persisted', async () => {
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

    // #505: an invalid-only upload is NOT a no-op -- the apply route persists
    // every invalid row as a StemGUID=NULL failed-measurement audit row (see
    // app/api/revisionupload/apply/route.ts). Apply must stay enabled or that
    // persisted trace is unreachable for an invalid-only file.
    expect(screen.getByTestId('revision-match-apply')).not.toBeDisabled();
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

  it('cancels the in-flight revision match request and returns to start without showing an error', async () => {
    const user = userEvent.setup();
    const { signals } = mockNeverSettlingRevisionMatchFetch();

    await driveToRevisionMatch(user);

    await waitFor(() => expect(screen.getByText(/matching revision rows/i)).toBeInTheDocument());
    const cancelButton = screen.getByText('Cancel and return to start');
    expect(cancelButton).toBeInTheDocument();

    await user.click(cancelButton);

    // Returns to the start screen (UploadStart, mocked above) rather than staying on
    // the loading state or falling through to the error screen.
    await waitFor(() => expect(screen.getByTestId('upload-start')).toBeInTheDocument());
    expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument();

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts the in-flight revision match request on unmount', async () => {
    const user = userEvent.setup();
    const { signals } = mockNeverSettlingRevisionMatchFetch();

    const { unmount } = await driveToRevisionMatch(user);

    await waitFor(() => expect(screen.getByText(/matching revision rows/i)).toBeInTheDocument());
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    unmount();

    expect(signals[0]?.aborted).toBe(true);
  });

  // #505 review round 2, finding 2: a 409 plan-hash mismatch must bounce the
  // UI back to the review screen carrying the apply route's AUTHORITATIVE
  // freshInvalidRows/freshInvalidRowsIntegrityHash (not a client-reconstructed
  // equivalent), demote the conflicting row out of matchedRows, and let the
  // user retry apply with that exact set/hash while keeping the same
  // uploadAttemptID throughout.
  it('recovers from a 409 plan-hash conflict by adopting the server-authoritative invalidRows/hash and successfully re-applying', async () => {
    const user = userEvent.setup();

    const UPLOAD_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
    const STALE_INVALID_ROWS_INTEGRITY_HASH = 'a'.repeat(64);
    const FRESH_INVALID_ROWS_INTEGRITY_HASH = 'b'.repeat(64);
    const rowA = { tag: 'T1', stemtag: 'S1', quadrat: 'Q1', dbh: '12.5', date: '2024-01-01' };
    const rowB = { tag: 'T2', stemtag: 'S1', quadrat: 'Q1', dbh: '22.5', date: '2024-01-01' };

    const matchResponse = {
      matchedRows: [
        {
          csvIndex: 0,
          csvRow: rowA,
          coreMeasurementID: 101,
          changes: { dbh: { from: '10', to: '12.5' } },
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: '2024-01-01', rawCodes: null, description: null }
        },
        {
          csvIndex: 1,
          csvRow: rowB,
          coreMeasurementID: 202,
          changes: { dbh: { from: '20', to: '22.5' } },
          existingValues: { measuredDBH: 20, measuredHOM: null, measurementDate: '2024-01-01', rawCodes: null, description: null }
        }
      ],
      newRows: [],
      invalidRows: [],
      counts: { matched: 2, matchedWithChanges: 2, new: 0, invalid: 0, total: 2 },
      uploadAttemptID: UPLOAD_ATTEMPT_ID,
      invalidRowsIntegrityHash: STALE_INVALID_ROWS_INTEGRITY_HASH
    };

    // Row A was demoted by the apply-time TOCTOU re-check; row B is untouched.
    const freshInvalidRows = [{ csvRow: rowA, csvIndex: 0, reason: 'Quadrat 999 was not found in this plot/census' }];
    const conflictResponse = {
      error: 'plan hash mismatch',
      freshPlan: {
        dataType: 'measurementssummary',
        rowCount: 1,
        rowPlans: [],
        aggregateEffects: [],
        maxSeverity: 'warn',
        planHash: 'fresh-hash',
        generatedAt: '2026-04-21T00:00:00Z',
        duplicateDeletions: []
      },
      freshInvalidRows,
      freshInvalidRowsIntegrityHash: FRESH_INVALID_ROWS_INTEGRITY_HASH
    };
    const applySuccessResponse = {
      updatedCount: 1,
      skippedCount: 0,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      failedRowCount: 1,
      applyErrors: [],
      validationPending: true
    };

    const applyRequestBodies: Array<Record<string, unknown>> = [];
    let applyCallCount = 0;
    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: new Headers({ 'content-type': 'application/json' }) });

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/revisionupload') {
        return jsonResponse(matchResponse);
      }
      if (url === '/api/revisionupload/apply') {
        applyCallCount += 1;
        applyRequestBodies.push(init?.body ? JSON.parse(init.body as string) : {});
        return applyCallCount === 1 ? jsonResponse(conflictResponse, 409) : jsonResponse(applySuccessResponse);
      }
      throw new Error(`Unexpected fetch call to ${url} in revision conflict recovery test`);
    }) as unknown as typeof global.fetch;

    await driveToRevisionMatch(user);

    await waitFor(() => expect(screen.getByText('2 rows to update')).toBeInTheDocument(), { timeout: 3000 });

    await user.click(screen.getByTestId('revision-match-apply'));

    // First apply attempt 409s -- the UI must bounce back to the review
    // screen (not stay on the apply screen, not silently drop row A) with
    // row A demoted into the Invalid tab.
    await waitFor(() => expect(applyRequestBodies).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('Invalid (1)')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('1 rows to update')).toBeInTheDocument();

    const retryApplyButton = screen.getByTestId('revision-match-apply');
    expect(retryApplyButton).not.toBeDisabled();
    await user.click(retryApplyButton);

    // The merged result now carries the conflict's freshPlan as bulkPlan, so
    // confirming apply routes through the ImpactSummary dialog instead of
    // calling onApply directly -- confirm there to actually resubmit.
    await waitFor(() => expect(screen.getByTestId('impact-summary-apply')).toBeInTheDocument());
    await user.click(screen.getByTestId('impact-summary-apply'));

    await waitFor(() => expect(applyRequestBodies).toHaveLength(2));

    // The retried apply must submit the server's authoritative invalidRows/
    // hash for row A, never the client's original (now-stale) empty
    // invalidRows/hash -- and uploadAttemptID must survive unchanged through
    // the whole conflict/retry cycle.
    expect(applyRequestBodies[0].uploadAttemptID).toBe(UPLOAD_ATTEMPT_ID);
    expect(applyRequestBodies[0].invalidRows).toEqual([]);
    expect(applyRequestBodies[0].invalidRowsIntegrityHash).toBe(STALE_INVALID_ROWS_INTEGRITY_HASH);
    expect(applyRequestBodies[1].uploadAttemptID).toBe(UPLOAD_ATTEMPT_ID);
    expect(applyRequestBodies[1].invalidRows).toEqual(freshInvalidRows);
    expect(applyRequestBodies[1].invalidRowsIntegrityHash).toBe(FRESH_INVALID_ROWS_INTEGRITY_HASH);
    // Row A must not resurface as a matched row on the retried apply -- only
    // row B (the real survivor) is submitted as matched.
    expect((applyRequestBodies[1].matchedRows as Array<{ coreMeasurementID: number }>).map(row => row.coreMeasurementID)).toEqual([202]);

    await waitFor(() => expect(screen.getByText('Revisions Applied')).toBeInTheDocument());
    expect(screen.getByTestId('revision-apply-failed-count')).toHaveTextContent('1 rejected row(s) recorded as failed measurements');
  });

  // #505 route.ts previousUploadAttemptID contract: a re-match of the SAME
  // selected upload must retain its attempt identity; a genuinely new
  // upload (a fresh session) must never inherit one.
  it('retains the uploadAttemptID across a same-upload refresh by sending it back as previousUploadAttemptID', async () => {
    const user = userEvent.setup();

    const FIRST_UPLOAD_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
    const SECOND_UPLOAD_ATTEMPT_ID = '22222222-2222-4222-9222-222222222222';
    const matchRequestBodies: Array<Record<string, unknown>> = [];
    let matchCallCount = 0;
    const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== '/api/revisionupload') {
        throw new Error(`Unexpected fetch call to ${url} in attempt-identity refresh test`);
      }
      matchCallCount += 1;
      matchRequestBodies.push(init?.body ? JSON.parse(init.body as string) : {});
      return jsonResponse({
        matchedRows: [],
        newRows: [{ csvRow: { tag: 'T001', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01' }, csvIndex: 0, reason: 'no-match-key-in-db' }],
        invalidRows: [],
        counts: { matched: 0, matchedWithChanges: 0, new: 1, invalid: 0, total: 1 },
        uploadAttemptID: matchCallCount === 1 ? FIRST_UPLOAD_ATTEMPT_ID : SECOND_UPLOAD_ATTEMPT_ID,
        invalidRowsIntegrityHash: 'a'.repeat(64)
      });
    }) as unknown as typeof global.fetch;

    await driveToRevisionMatch(user);
    // UploadRevisionMatch mounts only once the match response exists (uploadparent.tsx REVISION_MATCH case), with or without a toggle.
    await waitFor(() => expect(screen.getByTestId('revision-match-apply')).toBeInTheDocument());

    expect(matchRequestBodies).toHaveLength(1);
    expect(matchRequestBodies[0].previousUploadAttemptID, 'the first match of a new upload must never send a prior attempt identity').toBeUndefined();

    await user.click(screen.getByTestId('revision-match-refresh'));

    await waitFor(() => expect(matchRequestBodies).toHaveLength(2));
    expect(matchRequestBodies[1].previousUploadAttemptID, "refreshing the SAME upload must echo back the prior response's uploadAttemptID").toBe(
      FIRST_UPLOAD_ATTEMPT_ID
    );
  });

  // Regression target: a fresh component mount would trivially omit
  // previousUploadAttemptID even if the ref-clearing logic were broken (the
  // ref starts null regardless). This drives TWO uploads through the SAME
  // mounted UploadParent via the real Cancel -> Return to Start -> re-select
  // -> re-upload path, so a leaked ref would be caught: upload #2's match
  // call must never echo back upload #1's attemptID.
  it('omits previousUploadAttemptID for a second, genuinely new upload started via Cancel/Return to Start in the SAME mounted session', async () => {
    const user = userEvent.setup();

    const FIRST_UPLOAD_ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
    const SECOND_UPLOAD_ATTEMPT_ID = '55555555-5555-4555-9555-555555555555';
    const matchRequestBodies: Array<Record<string, unknown>> = [];
    let matchCallCount = 0;
    const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== '/api/revisionupload') {
        throw new Error(`Unexpected fetch call to ${url} in cross-upload identity-reset test`);
      }
      matchCallCount += 1;
      matchRequestBodies.push(init?.body ? JSON.parse(init.body as string) : {});
      return jsonResponse({
        matchedRows: [],
        newRows: [{ csvRow: { tag: 'T001', stemtag: 'S1', quadrat: 'Q1', dbh: '10', date: '2024-01-01' }, csvIndex: 0, reason: 'no-match-key-in-db' }],
        invalidRows: [],
        counts: { matched: 0, matchedWithChanges: 0, new: 1, invalid: 0, total: 1 },
        uploadAttemptID: matchCallCount === 1 ? FIRST_UPLOAD_ATTEMPT_ID : SECOND_UPLOAD_ATTEMPT_ID,
        invalidRowsIntegrityHash: 'd'.repeat(64)
      });
    }) as unknown as typeof global.fetch;

    // Deliberately NOT driveToRevisionMatch (it mounts a new component) --
    // a single mount drives both uploads below.
    render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} overrideUploadMode={UploadMode.REVISIONS} />);

    // Upload #1: establishes attempt A.
    await addFileAndContinueUpload(user);
    // UploadRevisionMatch mounts only once the match response exists (uploadparent.tsx REVISION_MATCH case), with or without a toggle.
    await waitFor(() => expect(screen.getByTestId('revision-match-apply')).toBeInTheDocument());
    expect(matchRequestBodies).toHaveLength(1);
    expect(matchRequestBodies[0].previousUploadAttemptID).toBeUndefined();

    // The REAL reset path: resetToStart() clears uploadMode too, so revision
    // mode must be explicitly re-selected before re-entering handleInitialSubmit's
    // revision branch -- exercising the actual production code (handleReturnToStart,
    // handleInitialSubmit's currentUploadAttemptIDRef reset), not a remount.
    await user.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.getByTestId('upload-start')).toBeInTheDocument());

    await user.click(screen.getByText('Select Measurements'));
    await user.click(screen.getByText('Select Revision Mode'));
    await user.click(screen.getByText('Finalize Selection'));
    await waitFor(() => expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument());

    // Upload #2: a genuinely new upload, same mount.
    await addFileAndContinueUpload(user);
    await waitFor(() => expect(matchRequestBodies).toHaveLength(2));

    expect(
      matchRequestBodies[1].previousUploadAttemptID,
      "a new upload started via the real reset path must never echo back the previous upload's attempt identity"
    ).toBeUndefined();
  });

  it('hands the revision apply counts, failedRowCount included, to the completion screen (#525 item 4)', async () => {
    const REVISION_APPLY_TO_COMPLETE_TIMEOUT_MS = 6000;
    mockUploadFireAzureBehavior.advanceToComplete = true;
    const user = userEvent.setup();
    const changedRow = { tag: 'T525', stemtag: 'S1', quadrat: 'Q1', dbh: '12.5', date: '2024-01-01' };
    const matchResponse = {
      matchedRows: [
        {
          csvIndex: 0,
          csvRow: changedRow,
          coreMeasurementID: 525,
          changes: { dbh: { from: '10', to: '12.5' } },
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: '2024-01-01', rawCodes: null, description: null }
        }
      ],
      newRows: [],
      invalidRows: [{ csvRow: { tag: 'T404', stemtag: 'S1' }, csvIndex: 1, reason: 'No matching identity found in the active census' }],
      counts: { matched: 1, matchedWithChanges: 1, new: 0, invalid: 1, total: 2 }
    };
    const applyResponse = {
      updatedCount: 1,
      skippedCount: 0,
      insertedCount: 0,
      deletedDuplicateCount: 0,
      failedRowCount: 1,
      applyErrors: [],
      validationPending: false
    };
    mockRevisionUploadFetch({ matchResponse, applyResponse });

    await driveToRevisionMatch(user);
    await waitFor(() => expect(screen.getByText('1 rows to update')).toBeInTheDocument(), { timeout: 3000 });
    // No bulkPlan in this response, so Apply calls onApply directly (still true after PR C).
    await user.click(screen.getByTestId('revision-match-apply'));

    const outcomeNode = await screen.findByTestId('upload-complete-outcome', {}, { timeout: REVISION_APPLY_TO_COMPLETE_TIMEOUT_MS });
    const receivedOutcome = JSON.parse(outcomeNode.textContent ?? 'null');
    console.log(`[#525 item 4] outcome UploadComplete received: ${JSON.stringify(receivedOutcome)}`);
    expect(receivedOutcome).toEqual({
      kind: 'revisions',
      updatedCount: 1,
      deletedDuplicateCount: 0,
      insertedCount: 0,
      failedRowCount: 1,
      skippedCount: 0,
      applyErrorCount: 0,
      hasDuplicateCleanupOnlyRows: false
    });
  });
});

describe('mergeFreshRevisionPlan', () => {
  const baseResult: RevisionUploadResponse = {
    matchedRows: [],
    newRows: [],
    invalidRows: [],
    collapsedRows: [],
    counts: { matched: 0, matchedWithChanges: 0, new: 0, invalid: 0, collapsed: 0, total: 0 },
    bulkPlan: {
      dataType: 'measurementssummary',
      rowCount: 0,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'info',
      planHash: 'stale-hash',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    },
    uploadAttemptID: '11111111-1111-4111-8111-111111111111',
    invalidRowsIntegrityHash: 'a'.repeat(64)
  };

  function buildFreshPlan(overrides: Partial<BulkEditPlan> = {}): BulkEditPlan {
    return {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: 'fresh-hash',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: [],
      ...overrides
    };
  }

  it('adopts the server-authoritative freshInvalidRows/freshInvalidRowsIntegrityHash verbatim, without recomputing an equivalent set from freshPlan.rowPlans', () => {
    const result: RevisionUploadResponse = {
      ...baseResult,
      matchedRows: [
        {
          csvIndex: 0,
          csvRow: { tag: 'T1' },
          coreMeasurementID: 101,
          changes: { dbh: { from: '10', to: '12.5' } },
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: null, rawCodes: null, description: null }
        },
        {
          csvIndex: 1,
          csvRow: { tag: 'T2' },
          coreMeasurementID: 202,
          changes: { dbh: { from: '20', to: '22.5' } },
          existingValues: { measuredDBH: 20, measuredHOM: null, measurementDate: null, rawCodes: null, description: null }
        }
      ],
      counts: { matched: 2, matchedWithChanges: 2, new: 0, invalid: 0, collapsed: 0, total: 2 }
    };

    const freshInvalidRows = [{ csvRow: { tag: 'T1' }, csvIndex: 0, reason: 'Quadrat 999 was not found in this plot/census' }];
    const freshPlan = buildFreshPlan();

    const merged = mergeFreshRevisionPlan(result, freshPlan, freshInvalidRows, 'b'.repeat(64));

    expect(merged.invalidRows).toBe(freshInvalidRows);
    expect(merged.invalidRowsIntegrityHash).toBe('b'.repeat(64));
    expect(merged.matchedRows.map(row => row.coreMeasurementID)).toEqual([202]);
    expect(merged.bulkPlan).toBe(freshPlan);
    expect(merged.counts).toEqual({ matched: 1, matchedWithChanges: 1, new: 0, invalid: 1, collapsed: 0, total: 2 });
    // uploadAttemptID must survive the merge untouched -- a re-applied attempt
    // after a conflict is still the same attempt, not a new upload.
    expect(merged.uploadAttemptID).toBe(baseResult.uploadAttemptID);
  });

  it('demotes a matched row by matching freshInvalidRows entries on csvIndex, never on its array position (regression: freshPlan.rowPlans is indexed over the survivor-only bulk input apply rebuilt, not the source CSV)', () => {
    // csvIndex (10) deliberately differs from this row's array position (0)
    // in both matchedRows and freshPlan.rowPlans.
    const result: RevisionUploadResponse = {
      ...baseResult,
      matchedRows: [
        {
          csvIndex: 10,
          csvRow: { tag: 'T1' },
          coreMeasurementID: 101,
          changes: { dbh: { from: '10', to: '12.5' } },
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: null, rawCodes: null, description: null }
        }
      ],
      counts: { matched: 1, matchedWithChanges: 1, new: 0, invalid: 0, collapsed: 0, total: 1 }
    };
    const freshInvalidRows = [{ csvRow: { tag: 'T1' }, csvIndex: 10, reason: 'Quadrat 999 was not found in this plot/census' }];

    const merged = mergeFreshRevisionPlan(result, buildFreshPlan(), freshInvalidRows, 'c'.repeat(64));

    expect(merged.matchedRows).toEqual([]);
    expect(merged.invalidRows).toEqual(freshInvalidRows);
  });

  it("refreshes a surviving matched row's changes from freshPlan.rowPlans, keyed by coreMeasurementID", () => {
    const result: RevisionUploadResponse = {
      ...baseResult,
      matchedRows: [
        {
          csvIndex: 0,
          csvRow: { tag: 'T1' },
          coreMeasurementID: 101,
          changes: { dbh: { from: '10', to: '12.5' } },
          existingValues: { measuredDBH: 10, measuredHOM: null, measurementDate: null, rawCodes: null, description: null }
        }
      ],
      counts: { matched: 1, matchedWithChanges: 1, new: 0, invalid: 0, collapsed: 0, total: 1 }
    };
    const freshPlan = buildFreshPlan({
      rowPlans: [
        {
          rowIndex: 0,
          targetID: 101,
          status: 'matched',
          plan: {
            dataType: 'measurementssummary',
            targetID: 101,
            fieldChanges: [{ field: 'dbh', from: '10', to: '13.0' }],
            effects: [],
            maxSeverity: 'info',
            planHash: 'member-plan',
            generatedAt: '2026-04-21T00:00:00Z'
          }
        }
      ]
    });

    const merged = mergeFreshRevisionPlan(result, freshPlan, [], 'd'.repeat(64));

    expect(merged.matchedRows[0].changes).toEqual({ dbh: { from: '10', to: '13.0' } });
  });
});

// Issue #504: a header-only CSV was shown as "Valid" by client validation, submitted as
// a measurements Clean Re-Upload, and the server-side census replacement silently
// deleted every existing measurement. UploadParent now fetches the existing row count
// for the exact plot+census being replaced before a Clean Re-Upload is allowed to
// start, and requires a typed confirmation whenever that count is greater than zero.
describe('UploadParent - Measurements Clean Re-Upload replacement confirmation (issue #504)', () => {
  const mockOnReset = vi.fn();
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
    compatCensusValue = { plotCensusNumber: 3, dateRanges: [{ censusID: 1 }] };
    compatPlotValue = { plotID: 1, plotName: 'Test Plot' };
    compatSiteValue = { schemaName: 'forestgeo_testing', siteName: 'Test Site' };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockReplacementPreviewFetch(responder: (url: string) => { ok: boolean; status?: number; json?: unknown } | Promise<Response>) {
    const calls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      if (!url.startsWith('/api/uploads/replacement-preview')) {
        throw new Error(`Unexpected fetch call to ${url} in replacement-preview test`);
      }
      const result = responder(url);
      if (result instanceof Promise) return result;
      return new Response(JSON.stringify(result.json ?? {}), {
        status: result.status ?? (result.ok ? 200 : 500),
        headers: new Headers({ 'content-type': 'application/json' })
      });
    });
    global.fetch = impl as unknown as typeof global.fetch;
    return { calls, impl };
  }

  async function driveToCleanReuploadContinue(user: ReturnType<typeof userEvent.setup>) {
    const renderResult = render(
      <UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} overrideUploadMode={UploadMode.CLEAN_REUPLOAD} />
    );

    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));

    await user.click(screen.getByText('Continue Upload'));

    return renderResult;
  }

  it('shows a typed confirmation naming the existing row count, blocks Continue until the exact phrase is typed, and proceeds to UPLOAD_SQL once confirmed', async () => {
    const user = userEvent.setup();
    const { calls } = mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 20 } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument());
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('plotID=1');
    expect(calls[0]).toContain('censusID=1');
    expect(calls[0]).toContain('schema=forestgeo_testing');

    const confirmButton = screen.getByTestId('measurement-replacement-confirm');
    expect(confirmButton).toBeDisabled();

    const input = screen.getByTestId('measurement-replacement-typed-confirm-input');
    await user.type(input, 'DELETE 20');
    expect(confirmButton).not.toBeDisabled();

    await user.click(confirmButton);

    await waitFor(() => expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument());
    expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument();
  });

  it('Cancel preserves the file list and review state, and never starts the upload', async () => {
    const user = userEvent.setup();
    mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 20 } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument());

    await user.click(screen.getByTestId('measurement-replacement-cancel'));

    await waitFor(() => expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument());

    // Still on the file-parse screen with the same file -- Cancel must not have
    // advanced reviewState or cleared the uploader's selections.
    expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();
    expect(screen.getByTestId('file-count')).toHaveTextContent('1');
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument();
  });

  it('proceeds straight to UPLOAD_SQL without any confirmation dialog when the existing row count is zero', async () => {
    const user = userEvent.setup();
    mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 0 } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument());
    expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument();
  });

  it('blocks with an error (never proceeding to UPLOAD_SQL) when the replacement-preview request fails', async () => {
    const user = userEvent.setup();
    mockReplacementPreviewFetch(() => ({ ok: false, status: 500, json: { error: 'boom' } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByTestId('upload-error')).toBeInTheDocument());
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument();
  });

  it('blocks with an error when the server reports a malformed (non-numeric/negative) count rather than treating it as zero', async () => {
    const user = userEvent.setup();
    mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: -1 } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByTestId('upload-error')).toBeInTheDocument());
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
  });

  it('ignores a stale replacement-preview response once the scope it was requested for has changed (no dialog, no progression)', async () => {
    const user = userEvent.setup();
    let releaseFetch: (() => void) | undefined;
    const deferred = new Promise<void>(resolve => {
      releaseFetch = resolve;
    });
    const { calls } = mockReplacementPreviewFetch(async () => {
      await deferred;
      return new Response(JSON.stringify({ existingRowCount: 20 }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });
    });

    await driveToCleanReuploadContinue(user);
    await waitFor(() => expect(calls).toHaveLength(1));

    // Change files while the first check is still in flight: adding a second file gives
    // fileManagement.files a new reference, which the invalidation effect and filesSnapshot check are bound to.
    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('2'));

    releaseFetch?.();

    // The stale response must not resurrect a confirmation dialog for the scope it
    // was originally requested under, nor advance past UPLOAD_FILES.
    await waitFor(() => {
      expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument();
  });

  it('invalidates a pending confirmation when a NEW File object replaces the existing one under the same name, and resets the typed text on the next request even though the count is unchanged', async () => {
    const user = userEvent.setup();
    const { calls } = mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 20 } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument());
    expect(calls).toHaveLength(1);

    const firstInput = screen.getByTestId('measurement-replacement-typed-confirm-input');
    await user.type(firstInput, 'DELETE 20');
    expect(screen.getByTestId('measurement-replacement-confirm')).not.toBeDisabled();

    // useFileManagement tracks files by array reference, not by name: swapping in a
    // new File object (same name, same lastModified) must still invalidate the
    // confirmation that was computed for the old object.
    await user.click(screen.getByText('Replace First File With New Object'));

    await waitFor(() => expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument());
    expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();

    // Re-trigger the check against the replacement file. The server reports the same
    // existingRowCount (20) as before, so a naive "reset only when the count changes"
    // implementation would leave the old 'DELETE 20' text sitting in the input --
    // confirming would then look valid without the user ever having re-typed it for
    // this new request.
    await user.click(screen.getByText('Continue Upload'));

    await waitFor(() => expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument());
    expect(calls).toHaveLength(2);

    const secondInput = screen.getByTestId('measurement-replacement-typed-confirm-input');
    expect(secondInput).toHaveValue('');
    expect(screen.getByTestId('measurement-replacement-confirm')).toBeDisabled();

    await user.type(secondInput, 'DELETE 20');
    await user.click(screen.getByTestId('measurement-replacement-confirm'));

    await waitFor(() => expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument());
  });

  it('discards a stale replacement-preview response reporting existingRowCount 0 for a File that was replaced while the request was in flight, never auto-starting the upload', async () => {
    const user = userEvent.setup();
    let releaseFetch: (() => void) | undefined;
    const deferred = new Promise<void>(resolve => {
      releaseFetch = resolve;
    });
    const { calls } = mockReplacementPreviewFetch(async () => {
      await deferred;
      return new Response(JSON.stringify({ existingRowCount: 0 }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) });
    });

    await driveToCleanReuploadContinue(user);
    await waitFor(() => expect(calls).toHaveLength(1));

    // Swap in a NEW File object under the same name while the first check for the
    // OLD File is still pending. useFileManagement's new array reference triggers the
    // invalidation effect, bumping replacementCheckTokenRef before the stale request
    // ever resolves.
    await user.click(screen.getByText('Replace First File With New Object'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));

    // Now resolve the OLD request. existingRowCount 0 would, for a current request,
    // skip confirmation and proceed straight to UPLOAD_SQL (see the "proceeds straight
    // to UPLOAD_SQL ... when the existing row count is zero" test above) -- so if the
    // token check were missing or wrong, this stale response would auto-start the
    // upload for the replaced File it was never actually computed for.
    await act(async () => {
      releaseFetch?.();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Still a single request was ever made (for the OLD file); the replacement never
    // triggered its own check because the user never clicked Continue Upload again.
    expect(calls).toHaveLength(1);
    // Still at file selection, with exactly the one (replaced) file -- the stale
    // response must not have advanced reviewState.
    expect(screen.getByTestId('upload-parse-files')).toBeInTheDocument();
    expect(screen.getByTestId('file-count')).toHaveTextContent('1');
    // Decisive: the upload must NOT have auto-started from the stale zero-count result.
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
  });

  it.each([
    { label: 'a fractional count', existingRowCount: 3.5 },
    { label: 'a count beyond Number.MAX_SAFE_INTEGER', existingRowCount: Number.MAX_SAFE_INTEGER + 1 },
    { label: 'a count sent as a string', existingRowCount: '42' }
  ])('blocks with an error (never zero, never proceeding) when the server reports $label for existingRowCount', async ({ existingRowCount }) => {
    const user = userEvent.setup();
    mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount } }));

    await driveToCleanReuploadContinue(user);

    await waitFor(() => expect(screen.getByTestId('upload-error')).toBeInTheDocument());
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm measurement replacement')).not.toBeInTheDocument();
  });

  it('routes the ArcGIS "Proceed with import" action through the same replacement-confirmation gate as a CSV Clean Re-Upload', async () => {
    const user = userEvent.setup();
    const { calls } = mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 20 } }));

    render(
      <UploadParent
        onReset={mockOnReset}
        overrideUploadForm={FormType.measurements}
        overrideUploadMode={UploadMode.CLEAN_REUPLOAD}
        overrideSourceFormat={SourceFormat.arcgis_xlsx}
      />
    );

    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));
    await user.click(screen.getByText('Continue Upload'));

    // handleInitialSubmit checks sourceFormat === arcgis_xlsx before the clean-reupload
    // branch, so the ArcGIS workbook goes to its own preflight screen first; the
    // replacement-preview check must not have fired yet.
    await waitFor(() => expect(screen.getByTestId('upload-arcgis-preflight')).toBeInTheDocument());
    expect(calls).toHaveLength(0);

    await user.click(screen.getByText('Proceed with import'));

    // onProceed wraps its work in requestCleanMeasurementsReplacementConfirmation, the
    // exact same gate the CSV path uses -- it must not be bypassed for ArcGIS imports.
    await waitFor(() => expect(screen.getByText('Confirm measurement replacement')).toBeInTheDocument());
    expect(calls).toHaveLength(1);
    expect(screen.queryByTestId('upload-fire-sql')).not.toBeInTheDocument();

    const input = screen.getByTestId('measurement-replacement-typed-confirm-input');
    await user.type(input, 'DELETE 20');
    await user.click(screen.getByTestId('measurement-replacement-confirm'));

    await waitFor(() => expect(screen.getByTestId('upload-fire-sql')).toBeInTheDocument());
  });

  it('does not gate a Revisions upload behind the replacement-preview check', async () => {
    const user = userEvent.setup();
    const { calls } = mockReplacementPreviewFetch(() => ({ ok: true, json: { existingRowCount: 20 } }));
    mockRevisionUploadFetchForGatingCheck();

    render(<UploadParent onReset={mockOnReset} overrideUploadForm={FormType.measurements} overrideUploadMode={UploadMode.REVISIONS} />);

    await user.click(screen.getByText('Add File'));
    await waitFor(() => expect(screen.getByTestId('file-count')).toHaveTextContent('1'));
    await user.click(screen.getByText('Continue Upload'));

    // Revisions goes through /api/revisionupload, never /api/uploads/replacement-preview.
    await waitFor(() => expect(screen.getByText(/matching revision rows/i)).toBeInTheDocument());
    expect(calls).toHaveLength(0);
  });

  function mockRevisionUploadFetchForGatingCheck() {
    // Layered on top of mockReplacementPreviewFetch's global.fetch stub: Revisions
    // mode must never call replacement-preview, so this only needs to keep
    // /api/revisionupload from throwing as "unexpected" if the gate were ever
    // (incorrectly) bypassed in the other direction.
    const previous = global.fetch;
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/revisionupload') {
        return new Promise<Response>(() => {}); // never resolves; test only checks the loading state
      }
      return previous(input, init);
    }) as unknown as typeof global.fetch;
  }
});

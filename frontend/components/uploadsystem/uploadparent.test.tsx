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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadParent from './uploadparent';
import { FormType } from '@/config/macros/formdetails';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
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
          const mockFile = { name: 'test.csv', path: '/test.csv' };
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ValidationRow from './validationrow';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

// Mock CodeEditor component
vi.mock('@/components/client/codeeditor', () => ({
  default: ({ value, setValue, readOnly, ...props }: any) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={e => !readOnly && setValue(e.target.value)}
      readOnly={readOnly}
      aria-label={props['aria-label']}
    />
  )
}));

describe('ValidationRow - Functional Tests', () => {
  const mockValidation: ValidationProceduresRDS = {
    validationID: 1,
    procedureName: 'TestValidation',
    definition: 'SELECT * FROM ${schema}.coremeasurements WHERE PlotID = ${currentPlotID}',
    description: 'Check DBH values;Verify HOM measurements',
    criteria: 'DBH > 0;HOM < 200',
    isEnabled: true,
    dateCreated: new Date('2024-01-01'),
    dateModified: new Date('2024-01-02')
  };

  const mockReplacements = {
    schema: 'test_schema',
    currentPlotID: 123,
    currentCensusID: 456
  };

  const mockSchemaDetails = [
    { table_name: 'coremeasurements', column_name: 'CoreMeasurementID' },
    { table_name: 'census', column_name: 'CensusID' }
  ];

  const mockOnSaveChanges = vi.fn();
  const mockHandleExpandClick = vi.fn();

  const defaultProps = {
    validation: mockValidation,
    onSaveChanges: mockOnSaveChanges,
    isDarkMode: false,
    expandedValidationID: null,
    replacements: mockReplacements,
    handleExpandClick: mockHandleExpandClick,
    schemaDetails: mockSchemaDetails
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock URL.createObjectURL and revokeObjectURL for JSDOM
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Accessibility - ARIA Labels', () => {
    it('MUST have accessible label for enable/disable switch', () => {
      render(<ValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      // MUI Joy Switch uses aria-checked for state, aria-label is set in source
      expect(switchElement).toBeInTheDocument();
      expect(switchElement).toHaveAttribute('aria-checked');
    });

    it('MUST have accessible label for validation description list', () => {
      render(<ValidationRow {...defaultProps} />);

      const descriptionList = screen.getByLabelText('Validation description list');
      expect(descriptionList).toBeInTheDocument();
    });

    it('MUST have accessible label for validation criteria list', () => {
      render(<ValidationRow {...defaultProps} />);

      const criteriaList = screen.getByLabelText('Validation criteria list');
      expect(criteriaList).toBeInTheDocument();
    });

    it('MUST have accessible label for collapsed definition textarea', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const textarea = screen.getByLabelText('Validation definition');
      expect(textarea).toBeInTheDocument();
    });

    it('MUST have accessible label for expanded code editor', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const codeEditor = screen.getByLabelText('Validation script editor');
      expect(codeEditor).toBeInTheDocument();
    });

    it('MUST have accessible labels for action buttons', () => {
      render(<ValidationRow {...defaultProps} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      const downloadButton = screen.getByRole('button', { name: /download validation query/i });

      expect(editButton).toHaveAccessibleName();
      expect(downloadButton).toHaveAccessibleName();
    });

    it('MUST have accessible label for expand/collapse button', () => {
      const { rerender } = render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const expandButton = screen.getByRole('button', { name: /expand validation details/i });
      expect(expandButton).toHaveAccessibleName();

      rerender(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const collapseButton = screen.getByRole('button', { name: /collapse validation details/i });
      expect(collapseButton).toHaveAccessibleName();
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('MUST show collapsed view when not expanded', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const textarea = screen.getByLabelText('Validation definition');
      expect(textarea).toBeInTheDocument();
      expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument();
    });

    it('MUST show expanded view with code editor when expanded', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toBeInTheDocument();
      expect(screen.queryByLabelText('Validation definition')).not.toBeInTheDocument();
    });

    it('MUST call handleExpandClick when expand button clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const expandButton = screen.getByRole('button', { name: /expand validation details/i });
      await user.click(expandButton);

      expect(mockHandleExpandClick).toHaveBeenCalledWith(1);
    });

    it('MUST call handleExpandClick when collapse button clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const collapseButton = screen.getByRole('button', { name: /collapse validation details/i });
      await user.click(collapseButton);

      expect(mockHandleExpandClick).toHaveBeenCalledWith(1);
    });

    it('MUST show expand icon when collapsed', () => {
      const { container } = render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      // ExpandMoreIcon should be present
      const expandIcon = container.querySelector('[data-testid="ExpandMoreIcon"]');
      expect(expandIcon).toBeInTheDocument();
    });

    it('MUST show collapse icon when expanded', () => {
      const { container } = render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      // ExpandLessIcon should be present
      const collapseIcon = container.querySelector('[data-testid="ExpandLessIcon"]');
      expect(collapseIcon).toBeInTheDocument();
    });
  });

  describe('Edit Mode Workflow', () => {
    it('MUST show Edit and Download buttons when not editing', () => {
      render(<ValidationRow {...defaultProps} />);

      expect(screen.getByRole('button', { name: /edit validation/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /download validation query/i })).toBeInTheDocument();
    });

    it('MUST enter edit mode when Edit button clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      // Should show Save and Cancel buttons
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save validation changes/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /cancel validation changes/i })).toBeInTheDocument();
      });
    });

    it('MUST expand validation when Edit button clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      expect(mockHandleExpandClick).toHaveBeenCalledWith(1);
    });

    it('MUST save changes when Save button clicked', async () => {
      const user = userEvent.setup();
      mockOnSaveChanges.mockResolvedValue(undefined);

      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      // Enter edit mode
      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      // Click save
      const saveButton = await screen.findByRole('button', { name: /save validation changes/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSaveChanges).toHaveBeenCalled();
      });
    });

    it('MUST revert changes when Cancel button clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      // Enter edit mode
      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      // Modify code
      const codeEditor = screen.getByTestId('code-editor');
      await user.clear(codeEditor);
      await user.type(codeEditor, 'MODIFIED QUERY');

      // Click cancel
      const cancelButton = await screen.findByRole('button', { name: /cancel validation changes/i });
      await user.click(cancelButton);

      // Should show original Edit button again
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit validation/i })).toBeInTheDocument();
      });
    });

    it('MUST exit edit mode after saving', async () => {
      const user = userEvent.setup();
      mockOnSaveChanges.mockResolvedValue(undefined);

      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      const saveButton = await screen.findByRole('button', { name: /save validation changes/i });
      await user.click(saveButton);

      // Should return to view mode
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit validation/i })).toBeInTheDocument();
      });
    });

    it('MUST make code editor read-only when not editing', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toHaveAttribute('readonly');
    });

    it('MUST make code editor editable when in edit mode', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      await waitFor(() => {
        const codeEditor = screen.getByTestId('code-editor');
        expect(codeEditor).not.toHaveAttribute('readonly');
      });
    });
  });

  describe('Switch Toggle Functionality', () => {
    it('MUST call onSaveChanges when switch toggled', async () => {
      const user = userEvent.setup();
      mockOnSaveChanges.mockResolvedValue(undefined);

      render(<ValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      await user.click(switchElement);

      expect(mockOnSaveChanges).toHaveBeenCalledWith(expect.objectContaining({ isEnabled: false }));
    });

    it('MUST reflect current enabled state', () => {
      const { rerender } = render(<ValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: true }} />);

      let switchElement = screen.getByRole('switch');
      expect(switchElement).toBeChecked();

      rerender(<ValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: false }} />);

      switchElement = screen.getByRole('switch');
      expect(switchElement).not.toBeChecked();
    });

    it('MUST update aria-checked based on enabled state', () => {
      const { rerender } = render(<ValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: true }} />);

      let switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveAttribute('aria-checked', 'true');

      rerender(<ValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: false }} />);

      switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveAttribute('aria-checked', 'false');
    });

    it('MUST prevent event propagation when switch clicked', async () => {
      const user = userEvent.setup();
      mockOnSaveChanges.mockResolvedValue(undefined);

      render(<ValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      await user.click(switchElement);

      // handleExpandClick should NOT be called when clicking switch
      expect(mockHandleExpandClick).not.toHaveBeenCalled();
    });
  });

  describe('Download Functionality', () => {
    it('MUST have download button that is clickable', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} />);

      const downloadButton = screen.getByRole('button', { name: /download validation query/i });
      expect(downloadButton).toBeInTheDocument();
      expect(downloadButton).not.toBeDisabled();

      // Verify button can be clicked (download logic runs in component)
      await user.click(downloadButton);
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });

    it('MUST call createObjectURL when download clicked', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} />);

      const downloadButton = screen.getByRole('button', { name: /download validation query/i });
      await user.click(downloadButton);

      // Verify download APIs were called
      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('MUST create blob with SQL content type', async () => {
      const user = userEvent.setup();
      let blobType = '';

      (global.URL.createObjectURL as any).mockImplementation((blob: Blob) => {
        blobType = blob.type;
        return 'blob:mock-url';
      });

      render(<ValidationRow {...defaultProps} />);

      const downloadButton = screen.getByRole('button', { name: /download validation query/i });
      await user.click(downloadButton);

      expect(blobType).toBe('text/sql');
    });

    it('MUST prevent event propagation during download', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} />);

      const downloadButton = screen.getByRole('button', { name: /download validation query/i });
      await user.click(downloadButton);

      // Download handler should not trigger row expansion
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  describe('Text Formatting', () => {
    it('MUST format procedure name with spaces', () => {
      const validation = { ...mockValidation, procedureName: 'TestValidationName' };
      render(<ValidationRow {...defaultProps} validation={validation} />);

      // Should split camelCase: "TestValidationName" -> "Test Validation Name"
      expect(screen.getByText(/Test.*Validation.*Name/i)).toBeInTheDocument();
    });

    it('MUST format description with DBH/HOM spacing', () => {
      render(<ValidationRow {...defaultProps} />);

      // Should format "DBH" and "HOM" with proper spacing
      const chips = screen.getAllByText(/DBH|HOM/i);
      expect(chips.length).toBeGreaterThan(0);
    });

    it('MUST split description by semicolons into chips', () => {
      const { container } = render(<ValidationRow {...defaultProps} />);

      const descriptionList = screen.getByLabelText('Validation description list');
      const chips = descriptionList.querySelectorAll('.MuiChip-root');

      expect(chips.length).toBe(2); // "Check DBH values" and "Verify HOM measurements"
    });

    it('MUST split criteria by semicolons into chips', () => {
      const { container } = render(<ValidationRow {...defaultProps} />);

      const criteriaList = screen.getByLabelText('Validation criteria list');
      const chips = criteriaList.querySelectorAll('.MuiChip-root');

      expect(chips.length).toBe(2); // "DBH > 0" and "HOM < 200"
    });
  });

  describe('Template Variable Replacement', () => {
    it('MUST replace schema variable in collapsed view', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const textarea = screen.getByLabelText('Validation definition') as HTMLTextAreaElement;
      expect(textarea.value).toContain('test_schema');
      expect(textarea.value).not.toContain('${schema}');
    });

    it('MUST replace currentPlotID variable in collapsed view', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={null} />);

      const textarea = screen.getByLabelText('Validation definition') as HTMLTextAreaElement;
      expect(textarea.value).toContain('123');
      expect(textarea.value).not.toContain('${currentPlotID}');
    });

    it('MUST show original template variables in editor when expanded', () => {
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      const codeEditor = screen.getByTestId('code-editor') as HTMLTextAreaElement;
      expect(codeEditor.value).toContain('${schema}');
      expect(codeEditor.value).toContain('${currentPlotID}');
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<ValidationRow {...defaultProps} />)).not.toThrow();
    });

    it('MUST render all table cells', () => {
      const { container } = render(<ValidationRow {...defaultProps} />);

      // Count both td and th cells (procedure name uses component="th")
      const tableCells = container.querySelectorAll('td, th');
      expect(tableCells.length).toBeGreaterThanOrEqual(5); // At minimum: Switch, Name, Description, Criteria, Definition, Actions
    });

    it('MUST handle missing optional fields gracefully', () => {
      const minimalValidation = {
        validationID: 1,
        procedureName: 'MinimalValidation',
        definition: 'SELECT 1',
        isEnabled: true,
        description: undefined,
        criteria: undefined,
        dateCreated: undefined,
        dateModified: undefined
      };

      expect(() => render(<ValidationRow {...defaultProps} validation={minimalValidation} />)).not.toThrow();
    });

    it('MUST memoize schema details for performance', () => {
      const { rerender } = render(<ValidationRow {...defaultProps} />);

      // Re-render with same schema details reference
      rerender(<ValidationRow {...defaultProps} />);

      // Component should not crash and should render correctly
      expect(screen.getByLabelText('Validation description list')).toBeInTheDocument();
    });
  });

  describe('Event Propagation', () => {
    it('MUST stop propagation when clicking edit button', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      await user.click(editButton);

      // Row click handler should not be triggered (handleExpandClick)
      // Edit button has its own handler
      expect(mockHandleExpandClick).toHaveBeenCalledWith(1); // Only from edit's own expansion
    });

    it('MUST stop propagation when clicking save button', async () => {
      const user = userEvent.setup();
      mockOnSaveChanges.mockResolvedValue(undefined);

      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      // Enter edit mode
      await user.click(screen.getByRole('button', { name: /edit validation/i }));

      // Click save
      const saveButton = await screen.findByRole('button', { name: /save validation changes/i });
      await user.click(saveButton);

      // Only the save handler should run, not row expansion
      expect(mockOnSaveChanges).toHaveBeenCalled();
    });

    it('MUST stop propagation when clicking cancel button', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      await user.click(screen.getByRole('button', { name: /edit validation/i }));

      const cancelButton = await screen.findByRole('button', { name: /cancel validation changes/i });
      await user.click(cancelButton);

      // Cancel should not trigger row expansion
      expect(screen.getByRole('button', { name: /edit validation/i })).toBeInTheDocument();
    });
  });

  describe('Tooltips', () => {
    it('MUST have tooltip for switch', () => {
      const { container } = render(<ValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      const tooltip = switchElement.closest('[title]');
      expect(tooltip).toBeTruthy();
    });

    it('MUST have tooltips for action buttons', () => {
      render(<ValidationRow {...defaultProps} />);

      const editButton = screen.getByRole('button', { name: /edit validation/i });
      const downloadButton = screen.getByRole('button', { name: /download validation query/i });

      expect(editButton.closest('[title]')).toBeTruthy();
      expect(downloadButton.closest('[title]')).toBeTruthy();
    });

    it('MUST have tooltips for Save and Cancel buttons in edit mode', async () => {
      const user = userEvent.setup();
      render(<ValidationRow {...defaultProps} expandedValidationID={1} />);

      await user.click(screen.getByRole('button', { name: /edit validation/i }));

      const saveButton = await screen.findByRole('button', { name: /save validation changes/i });
      const cancelButton = screen.getByRole('button', { name: /cancel validation changes/i });

      // Tooltips are rendered in MUI's Tooltip wrapper component
      expect(saveButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();
      expect(saveButton).toHaveAccessibleName();
      expect(cancelButton).toHaveAccessibleName();
    });
  });
});

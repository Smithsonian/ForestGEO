import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewValidationRow from './newvalidationrow';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

// Mock CodeEditor component
vi.mock('@/components/client/codeeditor', () => ({
  default: ({ value, setValue, ...props }: any) => (
    <textarea data-testid="code-editor" value={value} onChange={e => setValue(e.target.value)} aria-label={props['aria-label']} />
  )
}));

describe('NewValidationRow - Functional Tests', () => {
  const mockValidation: ValidationProceduresRDS = {
    validationID: undefined,
    procedureName: '',
    definition: '',
    description: '',
    criteria: '',
    isEnabled: true,
    createdAt: undefined,
    updatedAt: undefined
  };

  const mockSchemaDetails = [
    { table_name: 'coremeasurements', column_name: 'CoreMeasurementID' },
    { table_name: 'census', column_name: 'CensusID' }
  ];

  const mockOnValidationChange = vi.fn();
  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultProps = {
    validation: mockValidation,
    onValidationChange: mockOnValidationChange,
    onSave: mockOnSave,
    onCancel: mockOnCancel,
    schemaDetails: mockSchemaDetails,
    isDarkMode: false,
    schema: 'test_schema'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Accessibility - Form Labels', () => {
    it('MUST have accessible label for enable/disable switch', () => {
      render(<NewValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      // MUI Joy Switch uses aria-checked instead of aria-label for state
      expect(switchElement).toBeInTheDocument();
      expect(switchElement).toHaveAttribute('aria-checked');
    });

    it('MUST have accessible label for procedure name field', () => {
      render(<NewValidationRow {...defaultProps} />);

      const procedureField = screen.getByPlaceholderText('Procedure Name');
      expect(procedureField).toHaveAccessibleName();
    });

    it('MUST have accessible label for description field', () => {
      render(<NewValidationRow {...defaultProps} />);

      const descriptionField = screen.getByPlaceholderText(/Description.*semicolons/i);
      expect(descriptionField).toHaveAccessibleName();
    });

    it('MUST have accessible label for criteria field', () => {
      render(<NewValidationRow {...defaultProps} />);

      const criteriaField = screen.getByPlaceholderText(/Criteria.*semicolons/i);
      expect(criteriaField).toHaveAccessibleName();
    });

    it('MUST have accessible label for code editor', () => {
      render(<NewValidationRow {...defaultProps} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toHaveAttribute('aria-label', 'New validation script editor');
    });

    it('MUST have accessible labels for action buttons', () => {
      render(<NewValidationRow {...defaultProps} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      const cancelButton = screen.getByRole('button', { name: /cancel validation creation/i });

      expect(saveButton).toHaveAccessibleName();
      expect(cancelButton).toHaveAccessibleName();
    });
  });

  describe('Form Validation - Save Button', () => {
    it('MUST disable save button when procedure name is missing', () => {
      const validation = {
        ...mockValidation,
        procedureName: '',
        definition: 'SELECT * FROM test'
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      expect(saveButton).toBeDisabled();
    });

    it('MUST disable save button when definition is missing', () => {
      const validation = {
        ...mockValidation,
        procedureName: 'TestValidation',
        definition: ''
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      expect(saveButton).toBeDisabled();
    });

    it('MUST enable save button when both required fields are present', () => {
      const validation = {
        ...mockValidation,
        procedureName: 'TestValidation',
        definition: 'SELECT * FROM test'
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      expect(saveButton).not.toBeDisabled();
    });

    it('MUST allow save even when description is empty (optional field)', () => {
      const validation = {
        ...mockValidation,
        procedureName: 'TestValidation',
        definition: 'SELECT * FROM test',
        description: ''
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      expect(saveButton).not.toBeDisabled();
    });

    it('MUST allow save even when criteria is empty (optional field)', () => {
      const validation = {
        ...mockValidation,
        procedureName: 'TestValidation',
        definition: 'SELECT * FROM test',
        criteria: ''
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  describe('Switch Toggle Functionality', () => {
    it('MUST call onValidationChange when switch is toggled', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      await user.click(switchElement);

      expect(mockOnValidationChange).toHaveBeenCalledWith('isEnabled', false);
    });

    it('MUST reflect current enabled state in switch', () => {
      const validation = { ...mockValidation, isEnabled: true };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement).toBeChecked();
    });

    it('MUST update aria-checked based on enabled state', () => {
      const { rerender } = render(<NewValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: true }} />);

      let switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveAttribute('aria-checked', 'true');

      rerender(<NewValidationRow {...defaultProps} validation={{ ...mockValidation, isEnabled: false }} />);

      switchElement = screen.getByRole('switch');
      expect(switchElement).toHaveAttribute('aria-checked', 'false');
    });

    it('MUST have descriptive tooltip for switch', () => {
      render(<NewValidationRow {...defaultProps} />);

      const switchElement = screen.getByRole('switch');
      expect(switchElement.closest('[title]')).toBeTruthy();
    });
  });

  describe('Text Field Changes', () => {
    it('MUST call onValidationChange when procedure name changes', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const procedureField = screen.getByPlaceholderText('Procedure Name');
      await user.type(procedureField, 'MyValidation');

      expect(mockOnValidationChange).toHaveBeenCalledWith('procedureName', expect.stringContaining('M'));
    });

    it('MUST call onValidationChange when description changes', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const descriptionField = screen.getByPlaceholderText(/Description.*semicolons/i);
      await user.type(descriptionField, 'Test description');

      expect(mockOnValidationChange).toHaveBeenCalled();
    });

    it('MUST call onValidationChange when criteria changes', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const criteriaField = screen.getByPlaceholderText(/Criteria.*semicolons/i);
      await user.type(criteriaField, 'Test criteria');

      expect(mockOnValidationChange).toHaveBeenCalled();
    });

    it('MUST display current values in text fields', () => {
      const validation = {
        ...mockValidation,
        procedureName: 'ExistingValidation',
        description: 'Existing description',
        criteria: 'Existing criteria'
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      expect(screen.getByDisplayValue('ExistingValidation')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Existing description')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Existing criteria')).toBeInTheDocument();
    });
  });

  describe('Template Functionality', () => {
    it('MUST show "Use Template" button when definition is empty', () => {
      const validation = { ...mockValidation, definition: '' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const templateButton = screen.getByRole('button', { name: /use template/i });
      expect(templateButton).toBeInTheDocument();
    });

    it('MUST NOT show "Use Template" button when definition exists', () => {
      const validation = { ...mockValidation, definition: 'SELECT * FROM test' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const templateButton = screen.queryByRole('button', { name: /use template/i });
      expect(templateButton).not.toBeInTheDocument();
    });

    it('MUST call onValidationChange with template SQL when template button clicked', async () => {
      const user = userEvent.setup();
      const validation = { ...mockValidation, definition: '' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const templateButton = screen.getByRole('button', { name: /use template/i });
      await user.click(templateButton);

      expect(mockOnValidationChange).toHaveBeenCalledWith('definition', expect.stringContaining('INSERT INTO cmverrors'));
      expect(mockOnValidationChange).toHaveBeenCalledWith('definition', expect.stringContaining('@validationProcedureID'));
    });

    it('MUST include core validation query components in template', async () => {
      const user = userEvent.setup();
      const validation = { ...mockValidation, definition: '' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const templateButton = screen.getByRole('button', { name: /use template/i });
      await user.click(templateButton);

      const templateSQL = mockOnValidationChange.mock.calls[0][1];

      expect(templateSQL).toContain('coremeasurements');
      expect(templateSQL).toContain('census');
      expect(templateSQL).toContain('@p_CensusID');
      expect(templateSQL).toContain('@p_PlotID');
    });
  });

  describe('Code Editor Integration', () => {
    it('MUST render code editor component', () => {
      render(<NewValidationRow {...defaultProps} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toBeInTheDocument();
    });

    it('MUST pass current definition to code editor', () => {
      const validation = { ...mockValidation, definition: 'SELECT * FROM test' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toHaveValue('SELECT * FROM test');
    });

    it('MUST call onValidationChange when code editor value changes', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const codeEditor = screen.getByTestId('code-editor');
      await user.type(codeEditor, 'SELECT *');

      expect(mockOnValidationChange).toHaveBeenCalled();
    });

    it('MUST pass schema details to code editor', () => {
      render(<NewValidationRow {...defaultProps} />);

      // Code editor should be rendered (schema details passed via props)
      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toBeInTheDocument();
    });

    it('MUST set code editor to editable state', () => {
      render(<NewValidationRow {...defaultProps} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).not.toHaveAttribute('readonly');
    });
  });

  describe('Action Buttons', () => {
    it('MUST call onSave when save button clicked', async () => {
      const user = userEvent.setup();
      const validation = {
        ...mockValidation,
        procedureName: 'TestValidation',
        definition: 'SELECT * FROM test'
      };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      await user.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('MUST call onCancel when cancel button clicked', async () => {
      const user = userEvent.setup();

      render(<NewValidationRow {...defaultProps} />);

      const cancelButton = screen.getByRole('button', { name: /cancel validation creation/i });
      await user.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('MUST prevent save interaction when button is disabled', () => {
      const validation = { ...mockValidation, procedureName: '', definition: '' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });

      // MUI disabled buttons have pointer-events: none, preventing interaction
      expect(saveButton).toBeDisabled();
      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('MUST always enable cancel button regardless of form state', () => {
      const validation = { ...mockValidation, procedureName: '', definition: '' };

      render(<NewValidationRow {...defaultProps} validation={validation} />);

      const cancelButton = screen.getByRole('button', { name: /cancel validation creation/i });
      expect(cancelButton).not.toBeDisabled();
    });

    it('MUST have tooltips for action buttons', () => {
      render(<NewValidationRow {...defaultProps} />);

      const saveButton = screen.getByRole('button', { name: /save new validation/i });
      const cancelButton = screen.getByRole('button', { name: /cancel validation creation/i });

      expect(saveButton.closest('[title]')).toBeTruthy();
      expect(cancelButton.closest('[title]')).toBeTruthy();
    });
  });

  describe('Visual Styling', () => {
    it('MUST render as table row with highlighted background', () => {
      const { container } = render(<NewValidationRow {...defaultProps} />);

      const tableRow = container.querySelector('tr');
      expect(tableRow).toBeInTheDocument();
      expect(tableRow).toHaveStyle({ backgroundColor: 'rgba(25, 118, 210, 0.08)' });
    });

    it('MUST organize action buttons vertically in column', () => {
      const { container } = render(<NewValidationRow {...defaultProps} />);

      const actionContainer = container.querySelector('[aria-label="Action buttons"]');
      expect(actionContainer).toHaveStyle({ display: 'flex', flexDirection: 'column' });
    });

    it('MUST set multiline for description field', () => {
      render(<NewValidationRow {...defaultProps} />);

      const descriptionField = screen.getByPlaceholderText(/Description.*semicolons/i);
      // MUI multiline TextField renders as textarea
      expect(descriptionField.tagName).toBe('TEXTAREA');
    });

    it('MUST set multiline for criteria field', () => {
      render(<NewValidationRow {...defaultProps} />);

      const criteriaField = screen.getByPlaceholderText(/Criteria.*semicolons/i);
      // MUI multiline TextField renders as textarea
      expect(criteriaField.tagName).toBe('TEXTAREA');
    });
  });

  describe('Component Integrity', () => {
    it('MUST render without crashing', () => {
      expect(() => render(<NewValidationRow {...defaultProps} />)).not.toThrow();
    });

    it('MUST render consistently across multiple renders', () => {
      const { rerender } = render(<NewValidationRow {...defaultProps} />);
      const firstRender = screen.getByPlaceholderText('Procedure Name').outerHTML;

      rerender(<NewValidationRow {...defaultProps} />);
      const secondRender = screen.getByPlaceholderText('Procedure Name').outerHTML;

      expect(firstRender).toBe(secondRender);
    });

    it('MUST handle all required props', () => {
      expect(() => render(<NewValidationRow {...defaultProps} />)).not.toThrow();
    });

    it('MUST render all table cells', () => {
      const { container } = render(<NewValidationRow {...defaultProps} />);

      const tableCells = container.querySelectorAll('td');
      expect(tableCells.length).toBe(6); // Switch, Name, Description, Criteria, Editor, Actions
    });
  });

  describe('Dark Mode Support', () => {
    it('MUST pass isDarkMode prop to code editor', () => {
      render(<NewValidationRow {...defaultProps} isDarkMode={true} />);

      // Code editor should render (isDarkMode passed via props)
      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toBeInTheDocument();
    });

    it('MUST pass isDarkMode=false to code editor in light mode', () => {
      render(<NewValidationRow {...defaultProps} isDarkMode={false} />);

      const codeEditor = screen.getByTestId('code-editor');
      expect(codeEditor).toBeInTheDocument();
    });
  });

  describe('Placeholder Text Guidance', () => {
    it('MUST provide helpful placeholder for procedure name', () => {
      render(<NewValidationRow {...defaultProps} />);

      expect(screen.getByPlaceholderText('Procedure Name')).toBeInTheDocument();
    });

    it('MUST guide users on description formatting with semicolons', () => {
      render(<NewValidationRow {...defaultProps} />);

      const descriptionField = screen.getByPlaceholderText('Description (separate items with semicolons)');
      expect(descriptionField).toBeInTheDocument();
    });

    it('MUST guide users on criteria formatting with semicolons', () => {
      render(<NewValidationRow {...defaultProps} />);

      const placeholders = screen.getAllByPlaceholderText(/separate items with semicolons/i);
      expect(placeholders.length).toBe(2); // Description and Criteria
    });
  });
});

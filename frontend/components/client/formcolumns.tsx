'use client';

import { GridColDef, GridRenderEditCellParams, useGridApiContext } from '@mui/x-data-grid';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import moment from 'moment/moment';
import { Box, Input, Tooltip, Typography } from '@mui/joy';
import { DatePicker } from '@mui/x-date-pickers';
import React, { useEffect, useRef, useState } from 'react';
import useEnhancedEffect from '@mui/utils/useEnhancedEffect';
import { AttributeStatusOptions } from '@/config/sqlrdsdefinitions/core';
import { styled } from '@mui/joy/styles';
import { CheckCircleOutlined } from '@mui/icons-material';
import { FormType, TableHeadersByFormType } from '@/config/macros/formdetails';
import { standardizeGridColumns } from '@/components/client/clientmacros';

export const renderDatePicker = (params: GridRenderEditCellParams) => {
  const convertedValue = params.row.date ? moment(params.row.date, 'YYYY-MM-DD') : null;
  if (!convertedValue) return <></>;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '0'
      }}
    >
      <Input
        size={'lg'}
        value={convertedValue.format('MM-DD-YYYY')}
        disabled
        sx={{
          textAlign: 'center',
          width: '100%',
          overflow: 'hidden'
        }}
      />
    </Box>
  );
};

export const renderEditDatePicker = (params: GridRenderEditCellParams) => {
  const apiRef = useGridApiContext();
  const { id, row } = params;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: '0.5em', alignItems: 'center', marginY: 1 }}>
      <DatePicker
        label={'Recorded Date'}
        slotProps={{ textField: { size: 'small' } }}
        value={moment(row.date, 'YYYY-MM-DD')}
        onChange={newValue => {
          apiRef.current.setEditCellValue({ id, field: 'date', value: newValue ? newValue.format('YYYY-MM-DD') : null });
        }}
      />
    </Box>
  );
};

const getClosestAreaUnit = (input: string): string | null => {
  const normalizedInput = input.trim().toLowerCase();

  // Define threshold for acceptable "closeness" (tune this value)
  const threshold = 2;

  let closestUnit: string | null = null;
  let minDistance = Infinity;

  for (const option of areaSelectionOptions) {
    const distance = levenshteinDistance(normalizedInput, option);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      closestUnit = option;
    }
  }

  // Return the closest match if within the acceptable threshold, otherwise return null
  return closestUnit;
};

export const EditUnitsCell = (params: GridRenderEditCellParams & { fieldName: string; isArea: boolean }) => {
  const apiRef = useGridApiContext();
  const { id, fieldName, hasFocus, isArea } = params;
  const [value, setValue] = useState<string>(params.row[fieldName]);
  const [error, setError] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEnhancedEffect(() => {
    if (hasFocus && ref.current) {
      const input = ref.current.querySelector<HTMLInputElement>(`input[value="${value}"]`);
      input?.focus();
    }
  }, [hasFocus, value]);

  useEffect(() => {
    if (!(apiRef.current.getCellMode(id, fieldName) === 'edit')) {
      apiRef.current.startCellEditMode({ id, field: fieldName });
    }
  }, [apiRef, id, fieldName]);

  useEffect(() => {
    setError(!(isArea ? getClosestAreaUnit(value) : getClosestUnit(value)));
  }, [value]);

  const handleCommit = () => {
    const isValid = isArea ? getClosestAreaUnit(value) : getClosestUnit(value);

    if (!isValid) {
      apiRef.current.setEditCellValue({
        id,
        field: fieldName,
        value: ''
      });
      return;
    }

    apiRef.current.stopCellEditMode({ id, field: fieldName });
  };

  return (
    <Tooltip title={error ? 'Invalid unit entered!' : `${isArea ? areaSelectionOptions.join(', ') : unitSelectionOptions.join(', ')}`} color={'primary'}>
      <Input
        ref={ref}
        fullWidth
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          apiRef.current.setEditCellValue({
            id,
            field: fieldName,
            value: (isArea ? getClosestAreaUnit(value) : getClosestUnit(value)) || value
          });
          handleCommit();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            apiRef.current.setEditCellValue({
              id,
              field: fieldName,
              value: (isArea ? getClosestAreaUnit(value) : getClosestUnit(value)) || value
            });
            handleCommit();
          }
        }}
        error={error}
      />
    </Tooltip>
  );
};

const getClosestUnit = (input: string): string | null => {
  const normalizedInput = input.trim().toLowerCase();

  // Define threshold for acceptable "closeness" (tune this value)
  const threshold = 2;

  let closestUnit: string | null = null;
  let minDistance = Infinity;

  for (const option of unitSelectionOptions) {
    const distance = levenshteinDistance(normalizedInput, option);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      closestUnit = option;
    }
  }

  // Return the closest match if within the acceptable threshold, otherwise return null
  return closestUnit;
};

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // Deletion
        matrix[i][j - 1] + 1, // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  return matrix[a.length][b.length];
}

function normalizeString(str: string): string {
  return str.replace(/[\s-]+/g, '').toLowerCase();
}

const getClosestStatus = (input: string): string | null => {
  const normalizedInput = normalizeString(input);

  // Define threshold for acceptable "closeness" (tune this value)
  const threshold = 2;

  let closestStatus: string | null = null;
  let minDistance = Infinity;

  for (const option of AttributeStatusOptions) {
    const normalizedOption = normalizeString(option);
    const distance = levenshteinDistance(normalizedInput, normalizedOption);
    if (distance < minDistance && distance <= threshold) {
      minDistance = distance;
      closestStatus = option; // Return the original option, not the normalized one
    }
  }

  // Return the closest match if within the acceptable threshold, otherwise return null
  return closestStatus;
};

const StyledInput = styled('input')({
  border: 'none',
  minWidth: 0,
  outline: 0,
  padding: 0,
  paddingTop: '1em',
  flex: 1,
  color: 'inherit',
  backgroundColor: 'transparent',
  fontFamily: 'inherit',
  fontSize: 'inherit',
  fontStyle: 'inherit',
  fontWeight: 'inherit',
  lineHeight: 'inherit',
  textOverflow: 'ellipsis',
  '&::placeholder': {
    opacity: 0,
    transition: '0.1s ease-out'
  },
  '&:focus::placeholder': {
    opacity: 1
  },
  '&:focus ~ label, &:not(:placeholder-shown) ~ label, &:-webkit-autofill ~ label': {
    top: '0.5rem',
    fontSize: '0.75rem'
  },
  '&:focus ~ label': {
    color: 'var(--Input-focusedHighlight)'
  },
  '&:-webkit-autofill': {
    alignSelf: 'stretch'
  },
  '&:-webkit-autofill:not(* + &)': {
    marginInlineStart: 'calc(-1 * var(--Input-paddingInline))',
    paddingInlineStart: 'var(--Input-paddingInline)',
    borderTopLeftRadius: 'calc(var(--Input-radius) - var(--variant-borderWidth, 0px))',
    borderBottomLeftRadius: 'calc(var(--Input-radius) - var(--variant-borderWidth, 0px))'
  }
});

const StyledLabel = styled('label')(({ theme }) => ({
  position: 'absolute',
  lineHeight: 1,
  top: 'calc((var(--Input-minHeight) - 1em) / 2)',
  color: theme.vars.palette.text.tertiary,
  fontWeight: theme.vars.fontWeight.md,
  transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)'
}));

const InnerInput = React.forwardRef<
  HTMLInputElement,
  React.JSX.IntrinsicElements['input'] & {
    error?: boolean;
    noInput?: boolean;
  }
>(function InnerInput(props, ref) {
  const { error, noInput, ...rest } = props;
  const id = React.useId();

  return (
    <React.Fragment>
      <StyledInput {...rest} ref={ref} id={id} aria-invalid={error} />
      <StyledLabel htmlFor={id}>{noInput ? AttributeStatusOptions.join(', ') : error ? 'Invalid status' : 'Accepted!'}</StyledLabel>
    </React.Fragment>
  );
});

const EditStatusCell = (params: GridRenderEditCellParams) => {
  const apiRef = useGridApiContext();
  const { id, hasFocus } = params;
  const [value, setValue] = React.useState<string>(params.row['status']);
  const [error, setError] = React.useState<boolean>(false);
  const ref = React.useRef<HTMLDivElement>(null);

  useEnhancedEffect(() => {
    if (hasFocus && ref.current) {
      const input = ref.current.querySelector<HTMLInputElement>(`input[value="${value}"]`);
      input?.focus();
    }
  }, [hasFocus, value]);

  React.useEffect(() => {
    if (!(apiRef.current.getCellMode(id, 'status') === 'edit')) {
      apiRef.current.startCellEditMode({ id, field: 'status' });
    }
  }, [apiRef, id]);

  React.useEffect(() => {
    setError(!getClosestStatus(value) && value !== '');
  }, [value]);

  const handleCommit = () => {
    const correctedValue = getClosestStatus(value);

    console.log('handle commit: corrected value: ', correctedValue);

    apiRef.current.setEditCellValue({
      id,
      field: 'status',
      value: value
    });

    apiRef.current.stopCellEditMode({ id, field: 'status' });
  };

  return (
    <Input
      ref={ref}
      fullWidth
      value={value}
      endDecorator={<CheckCircleOutlined />}
      slots={{ input: InnerInput }}
      slotProps={{
        input: {
          placeholder: 'Enter status...',
          type: 'text',
          error,
          noInput: value === ''
        }
      }}
      sx={{ '--Input-minHeight': '56px', '--Input-radius': '6px' }}
      onChange={e => setValue(e.target.value)}
      onBlur={handleCommit}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          console.log('on key down: enter || tab');
          handleCommit();
        }
      }}
      error={error}
    />
  );
};

const getFieldMetadata = (formType: FormType, field: string) => {
  return TableHeadersByFormType[formType]?.find(header => header.label === field) || null;
};

const renderCustomHeader = (formType: FormType, field: string) => {
  const metadata = getFieldMetadata(formType, field);

  if (!metadata) return field; // Default to field name if no metadata is found.

  const { label, category, explanation } = metadata;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'start',
        overflow: 'hidden' // Prevents content overflow
      }}
    >
      <Typography
        level={'title-md'}
        sx={{
          fontWeight: category === 'required' ? 'bold' : 'normal'
        }}
      >
        {label}
      </Typography>
      {explanation && (
        <Typography
          level={'body-md'}
          color={'primary'}
          sx={{
            display: 'block',
            whiteSpace: 'normal', // Allows text wrapping
            wordWrap: 'break-word', // Ensures long words are wrapped
            overflow: 'hidden' // Prevents overflow
          }}
        >
          {explanation}
        </Typography>
      )}
    </Box>
  );
};

export const AttributesFormGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'code',
    headerName: 'Code',
    // renderHeader: () => renderCustomHeader(FormType.attributes, 'code'),
    flex: 1,
    editable: true
  },
  {
    field: 'description',
    headerName: 'Description',
    // renderHeader: () => renderCustomHeader(FormType.attributes, 'description'),
    flex: 1,
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    // renderHeader: () => renderCustomHeader(FormType.attributes, 'status'),
    flex: 1,
    editable: true
    // This is temporarily being suspended -- it's a nice to have, not a need to have
    // renderEditCell: params => <EditStatusCell {...params} />
  }
]);

export const PersonnelFormGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'firstname',
    headerName: 'First Name',
    flex: 1,
    editable: true
  },
  {
    field: 'lastname',
    headerName: 'Last Name',
    flex: 1,
    editable: true
  }
]);

export const SpeciesFormGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'spcode',
    headerName: 'Species Code',
    // renderHeader: () => renderCustomHeader(FormType.species, 'spcode'),
    flex: 1,
    editable: true
  },
  {
    field: 'family',
    headerName: 'Family',
    // renderHeader: () => renderCustomHeader(FormType.species, 'family'),
    flex: 1,
    editable: true
  },
  {
    field: 'genus',
    headerName: 'Genus',
    // renderHeader: () => renderCustomHeader(FormType.species, 'genus'),
    flex: 1,
    editable: true
  },
  {
    field: 'species',
    headerName: 'Species',
    // renderHeader: () => renderCustomHeader(FormType.species, 'species'),
    flex: 1,
    editable: true
  },
  {
    field: 'subspecies',
    headerName: 'Subspecies',
    // renderHeader: () => renderCustomHeader(FormType.species, 'subspecies'),
    flex: 1,
    editable: true
  },
  {
    field: 'idlevel',
    headerName: 'ID Level',
    // renderHeader: () => renderCustomHeader(FormType.species, 'idlevel'),
    flex: 1,
    editable: true
  },
  {
    field: 'authority',
    headerName: 'Authority',
    // renderHeader: () => renderCustomHeader(FormType.species, 'authority'),
    flex: 1,
    editable: true
  },
  {
    field: 'subspeciesauthority',
    headerName: 'Subspecies Authority',
    // renderHeader: () => renderCustomHeader(FormType.species, 'subspeciesauthority'),
    flex: 1,
    editable: true
  }
]);

export const QuadratsFormGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'quadrat',
    headerName: 'Quadrat Name',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'quadrat'),
    flex: 1,
    editable: true
  },
  {
    field: 'startx',
    headerName: 'StartX',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'startx'),
    flex: 1,
    type: 'number',
    editable: true
  },
  {
    field: 'starty',
    headerName: 'StartY',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'starty'),
    flex: 1,
    type: 'number',
    editable: true
  },
  {
    field: 'dimx',
    headerName: 'Dimension X',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'dimx'),
    flex: 1,
    type: 'number',
    editable: true
  },
  {
    field: 'dimy',
    headerName: 'Dimension Y',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'dimy'),
    flex: 1,
    type: 'number',
    editable: true
  },
  {
    field: 'area',
    headerName: 'Area',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'area'),
    flex: 1,
    type: 'number',
    editable: true
  },
  {
    field: 'quadratshape',
    headerName: 'Quadrat Shape',
    // renderHeader: () => renderCustomHeader(FormType.quadrats, 'quadratshape'),
    flex: 1,
    editable: true
  }
]);

export const MeasurementsFormGridColumns: GridColDef[] = standardizeGridColumns([
  {
    field: 'id',
    headerName: '#',
    flex: 0.3,
    editable: false
  },
  {
    field: 'tag',
    headerName: 'Tree Tag',
    // renderHeader: () => formatHeader('Tree', 'Tag'),
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'tag'),
    flex: 0.75,
    editable: true
  },
  {
    field: 'stemtag',
    headerName: 'Stem Tag',
    // renderHeader: () => formatHeader('Stem', 'Tag'),
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'stemtag'),
    flex: 0.75,
    editable: true
  },
  {
    field: 'spcode',
    headerName: 'Species Code',
    // renderHeader: () => formatHeader('Species', 'Code'),
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'spcode'),
    flex: 0.75,
    editable: true
  },
  {
    field: 'quadrat',
    headerName: 'Quadrat Name',
    // renderHeader: () => formatHeader('Quadrat', 'Name'),
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'quadrat'),
    flex: 0.75,
    editable: true
  },
  {
    field: 'lx',
    headerName: 'X',
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'lx'),
    flex: 0.3,
    type: 'number',
    editable: true
  },
  {
    field: 'ly',
    headerName: 'Y',
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'ly'),
    flex: 0.3,
    type: 'number',
    editable: true
  },
  {
    field: 'dbh',
    headerName: 'DBH',
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'dbh'),
    flex: 0.75,
    type: 'number',
    editable: true
  },
  {
    field: 'hom',
    headerName: 'HOM',
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'hom'),
    flex: 0.75,
    type: 'number',
    editable: true
  },
  {
    field: 'codes',
    headerName: 'Codes',
    // renderHeader: () => formatHeader('Quadrat', 'Name'),
    // renderHeader: () => renderCustomHeader(FormType.measurements, 'codes'),
    flex: 0.75,
    editable: true
  }
]);

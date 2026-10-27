'use client';

import { GridColDef, GridRenderEditCellParams, useGridApiContext } from '@mui/x-data-grid';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import { Box, Input, Tooltip, Typography } from '@mui/joy';
import { useEffect, useRef, useState } from 'react';
import useEnhancedEffect from '@mui/utils/useEnhancedEffect';
import { AttributeStatusEditorOptions } from '@/lib/db/definitions/core';
import { renderAttributeStatusCell } from '@/components/client/attributestatuscell';
import { FormType, TableHeadersByFormType } from '@/config/macros/formdetails';
import { standardizeGridColumns } from '@/components/client/clientmacros';

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
  }, [value, isArea]);

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
        aria-label={'choice for area measurement unit'}
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

const getFieldMetadata = (formType: FormType, field: string) => {
  return TableHeadersByFormType[formType]?.find(header => header.label === field) || null;
};

const _renderCustomHeader = (formType: FormType, field: string) => {
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
    editable: true,
    type: 'singleSelect',
    valueOptions: AttributeStatusEditorOptions,
    // Export a blank status as blank, not the editor's label.
    valueFormatter: (value: string | null) => value ?? '',
    renderCell: renderAttributeStatusCell
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
    flex: 1,
    editable: true
  },
  {
    field: 'family',
    headerName: 'Family',
    flex: 1,
    editable: true
  },
  {
    field: 'genus',
    headerName: 'Genus',
    flex: 1,
    editable: true
  },
  {
    field: 'species',
    headerName: 'Species',
    flex: 1,
    editable: true
  },
  {
    field: 'subspecies',
    headerName: 'Subspecies',
    flex: 1,
    editable: true
  },
  {
    field: 'idlevel',
    headerName: 'ID Level',
    flex: 1,
    editable: true
  },
  {
    field: 'authority',
    headerName: 'Authority',
    flex: 1,
    editable: true
  },
  {
    field: 'subspeciesauthority',
    headerName: 'Subspecies Authority',
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
    flex: 0.75,
    editable: true
  },
  {
    field: 'stemtag',
    headerName: 'Stem Tag',
    flex: 0.75,
    editable: true
  },
  {
    field: 'spcode',
    headerName: 'Species Code',
    flex: 0.75,
    editable: true
  },
  {
    field: 'quadrat',
    headerName: 'Quadrat Name',
    flex: 0.75,
    editable: true
  },
  {
    field: 'lx',
    headerName: 'X',
    flex: 0.3,
    type: 'number',
    editable: true
  },
  {
    field: 'ly',
    headerName: 'Y',
    flex: 0.3,
    type: 'number',
    editable: true
  },
  {
    field: 'dbh',
    headerName: 'DBH',
    flex: 0.75,
    type: 'number',
    editable: true
  },
  {
    field: 'hom',
    headerName: 'HOM',
    flex: 0.75,
    type: 'number',
    editable: true
  },
  {
    field: 'date',
    headerName: 'Date',
    flex: 0.5,
    editable: true
  },
  {
    field: 'codes',
    headerName: 'Codes',
    flex: 0.75,
    editable: true
  },
  {
    field: 'description',
    headerName: 'Description',
    flex: 0.75,
    editable: true
  }
]);

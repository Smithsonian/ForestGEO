/**
 * CSV Header Mapping and Data Parsing Utilities
 * Provides order-independent CSV processing with enhanced date format support and coordinate precision handling
 */

import moment from 'moment';
import { FormType, TableHeadersByFormType } from '@/config/macros/formdetails';
import { parseLineWithDelimiter } from './csvparserutils';

export interface HeaderMapping {
  csvIndex: number;
  expectedField: string;
  csvHeader: string;
}

export interface ParsedCsvData {
  headers: string[];
  mappedData: Record<string, any>[];
  warnings: DataWarning[];
  errors: string[];
}

export interface DataWarning {
  type: 'date_format' | 'coordinate_precision' | 'missing_header' | 'data_conversion';
  message: string;
  row?: number;
  column?: string;
  originalValue?: any;
  convertedValue?: any;
}

export interface CsvParseOptions {
  delimiter?: string;
  formType: FormType;
  strictHeaders?: boolean;
  dateFormats?: string[];
  coordinatePrecision?: number;
}

// Default supported date formats
const DEFAULT_DATE_FORMATS = [
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY/MM/DD',
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'YYYY.MM.DD',
  'MM.DD.YYYY',
  'DD.MM.YYYY',
  'MMMM DD, YYYY',
  'MMM DD, YYYY',
  'DD MMM YYYY',
  'DD MMMM YYYY',
  'YYYY-MM-DD HH:mm:ss',
  'MM/DD/YYYY HH:mm:ss',
  'DD/MM/YYYY HH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
  'YYYY-MM-DDTHH:mm:ss.SSSZ'
];

/**
 * Creates header mappings between CSV headers and expected form fields
 */
export function createHeaderMapping(
  csvHeaders: string[],
  expectedHeaders: string[]
): {
  mappings: HeaderMapping[];
  warnings: DataWarning[];
  errors: string[];
} {
  const mappings: HeaderMapping[] = [];
  const warnings: DataWarning[] = [];
  const errors: string[] = [];

  // Normalize headers for comparison (lowercase, trim, remove special chars)
  const normalizeHeader = (header: string) =>
    header
      .toLowerCase()
      .trim()
      .replace(/[_\s-]/g, '');

  const normalizedExpected = expectedHeaders.map(h => ({
    original: h,
    normalized: normalizeHeader(h)
  }));

  const normalizedCsv = csvHeaders.map((h, i) => ({
    original: h,
    normalized: normalizeHeader(h),
    index: i
  }));

  // Create mappings
  for (const expected of normalizedExpected) {
    const csvMatch = normalizedCsv.find(
      csv => csv.normalized === expected.normalized || csv.normalized.includes(expected.normalized) || expected.normalized.includes(csv.normalized)
    );

    if (csvMatch) {
      mappings.push({
        csvIndex: csvMatch.index,
        expectedField: expected.original,
        csvHeader: csvMatch.original
      });
    } else {
      warnings.push({
        type: 'missing_header',
        message: `Expected header '${expected.original}' not found in CSV. This field will be empty.`,
        column: expected.original
      });
    }
  }

  // Check for unmapped CSV headers
  const mappedIndices = new Set(mappings.map(m => m.csvIndex));
  for (let i = 0; i < csvHeaders.length; i++) {
    if (!mappedIndices.has(i)) {
      warnings.push({
        type: 'missing_header',
        message: `CSV header '${csvHeaders[i]}' does not match any expected field and will be ignored.`,
        column: csvHeaders[i]
      });
    }
  }

  return { mappings, warnings, errors };
}

/**
 * Parses date with multiple format support
 */
export function parseFlexibleDate(
  dateValue: any,
  customFormats?: string[]
): {
  date?: Date;
  warning?: DataWarning;
} {
  if (!dateValue || dateValue === '') {
    return {};
  }

  const formats = [...(customFormats || []), ...DEFAULT_DATE_FORMATS];
  const originalValue = dateValue.toString().trim();

  // Try each format
  for (const format of formats) {
    const parsed = moment(originalValue, format, true);
    if (parsed.isValid()) {
      const warning: DataWarning = {
        type: 'date_format',
        message: `Date '${originalValue}' parsed using format '${format}'`,
        originalValue,
        convertedValue: parsed.toDate()
      };
      return { date: parsed.toDate(), warning };
    }
  }

  // Try moment's flexible parsing as fallback
  const flexible = moment(originalValue);
  if (flexible.isValid()) {
    const warning: DataWarning = {
      type: 'date_format',
      message: `Date '${originalValue}' parsed using flexible format detection`,
      originalValue,
      convertedValue: flexible.toDate()
    };
    return { date: flexible.toDate(), warning };
  }

  return {
    warning: {
      type: 'date_format',
      message: `Unable to parse date '${originalValue}' with any known format`,
      originalValue
    }
  };
}

/**
 * Normalizes coordinate precision
 */
export function normalizeCoordinate(
  value: any,
  precision: number = 6
): {
  coordinate?: number;
  warning?: DataWarning;
} {
  if (value === null || value === undefined || value === '') {
    return {};
  }

  const numValue = typeof value === 'number' ? value : parseFloat(value.toString());

  if (isNaN(numValue)) {
    return {
      warning: {
        type: 'coordinate_precision',
        message: `Invalid coordinate value '${value}' - not a number`,
        originalValue: value
      }
    };
  }

  const rounded = Math.round(numValue * Math.pow(10, precision)) / Math.pow(10, precision);

  const warning: DataWarning | undefined =
    numValue !== rounded
      ? {
          type: 'coordinate_precision',
          message: `Coordinate ${numValue} rounded to ${precision} decimal places: ${rounded}`,
          originalValue: numValue,
          convertedValue: rounded
        }
      : undefined;

  return { coordinate: rounded, warning };
}

/**
 * Converts a data value based on field type
 */
export function convertDataValue(
  value: any,
  fieldName: string,
  rowIndex: number,
  options: CsvParseOptions
): {
  convertedValue: any;
  warnings: DataWarning[];
} {
  const warnings: DataWarning[] = [];
  let convertedValue = value;

  if (value === null || value === undefined || value === '') {
    return { convertedValue: null, warnings };
  }

  const fieldLower = fieldName.toLowerCase();

  // Date fields
  if (fieldLower.includes('date')) {
    const { date, warning } = parseFlexibleDate(value, options.dateFormats);
    convertedValue = date || null;
    if (warning) {
      warnings.push({ ...warning, row: rowIndex, column: fieldName });
    }
  }
  // Coordinate fields (x, y coordinates)
  else if (
    fieldLower.includes('lx') ||
    fieldLower.includes('ly') ||
    fieldLower.includes('localx') ||
    fieldLower.includes('localy') ||
    fieldLower === 'x' ||
    fieldLower === 'y'
  ) {
    const { coordinate, warning } = normalizeCoordinate(value, options.coordinatePrecision || 6);
    convertedValue = coordinate;
    if (warning) {
      warnings.push({ ...warning, row: rowIndex, column: fieldName });
    }
  }
  // Numeric fields
  else if (fieldLower.includes('dbh') || fieldLower.includes('hom') || fieldLower.includes('diameter') || fieldLower.includes('height')) {
    const numValue = typeof value === 'number' ? value : parseFloat(value.toString());
    if (!isNaN(numValue)) {
      convertedValue = numValue;
    } else if (value.toString().trim() !== '') {
      warnings.push({
        type: 'data_conversion',
        message: `Invalid numeric value '${value}' in field '${fieldName}'`,
        row: rowIndex,
        column: fieldName,
        originalValue: value
      });
      convertedValue = null;
    }
  }
  // String fields - trim whitespace
  else if (typeof value === 'string') {
    convertedValue = value.trim();
  }

  return { convertedValue, warnings };
}

/**
 * Parses CSV data with header mapping and data conversion
 */
export function parseCsvWithMapping(csvContent: string, options: CsvParseOptions): ParsedCsvData {
  const delimiter = options.delimiter || ',';
  const lines = csvContent.split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    return {
      headers: [],
      mappedData: [],
      warnings: [],
      errors: ['CSV file is empty']
    };
  }

  // Parse headers
  const csvHeaders = parseLineWithDelimiter(lines[0], delimiter);
  const expectedHeaders = TableHeadersByFormType[options.formType]?.map(h => h.label) || [];

  // Create header mappings
  const { mappings, warnings: headerWarnings, errors: headerErrors } = createHeaderMapping(csvHeaders, expectedHeaders);

  const allWarnings = [...headerWarnings];
  const errors = [...headerErrors];

  // Parse data rows
  const mappedData: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cells = parseLineWithDelimiter(line, delimiter);
    const rowData: Record<string, any> = {};

    // Apply header mappings
    for (const mapping of mappings) {
      const rawValue = cells[mapping.csvIndex] || null;
      const { convertedValue, warnings } = convertDataValue(rawValue, mapping.expectedField, i + 1, options);

      rowData[mapping.expectedField] = convertedValue;
      allWarnings.push(...warnings);
    }

    // Add missing expected fields as null
    for (const header of expectedHeaders) {
      if (!(header in rowData)) {
        rowData[header] = null;
      }
    }

    mappedData.push(rowData);
  }

  return {
    headers: csvHeaders,
    mappedData,
    warnings: allWarnings,
    errors
  };
}

// parseLineWithDelimiter is now imported from csvparserutils

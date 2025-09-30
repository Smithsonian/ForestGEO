import { NextRequest, NextResponse } from 'next/server';
import { HTTPResponses } from '@/config/macros';
import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

interface ValidationResponse {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export async function POST(request: NextRequest) {
  const connectionManager = ConnectionManager.getInstance();
  const schema = request.nextUrl.searchParams.get('schema');

  if (!schema) {
    return NextResponse.json({ isValid: false, errors: ['No schema provided'], warnings: [] }, { status: HTTPResponses.INVALID_REQUEST });
  }

  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ isValid: false, errors: ['No query provided'], warnings: [] }, { status: HTTPResponses.INVALID_REQUEST });
    }

    const validationResult: ValidationResponse = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Basic syntax validation - try to explain the query without executing it
    try {
      const explainQuery = `EXPLAIN ${query}`;
      await connectionManager.executeQuery(explainQuery);
    } catch (error: any) {
      validationResult.isValid = false;

      // Parse MySQL error messages for better user feedback
      const errorMessage = error.message || 'Unknown SQL error';

      if (errorMessage.includes('Table') && errorMessage.includes("doesn't exist")) {
        const tableMatch = errorMessage.match(/Table '([^']+)' doesn't exist/);
        if (tableMatch) {
          validationResult.errors.push(`Table '${tableMatch[1]}' does not exist in schema '${schema}'`);
        } else {
          validationResult.errors.push('Referenced table does not exist in the selected schema');
        }
      } else if (errorMessage.includes('Unknown column')) {
        const columnMatch = errorMessage.match(/Unknown column '([^']+)'/);
        if (columnMatch) {
          validationResult.errors.push(`Column '${columnMatch[1]}' does not exist`);
        } else {
          validationResult.errors.push('Referenced column does not exist');
        }
      } else if (errorMessage.includes('syntax error')) {
        validationResult.errors.push('SQL syntax error - please check your query syntax');
      } else {
        validationResult.errors.push(`SQL Error: ${errorMessage}`);
      }
    }

    // Additional schema-specific validations
    try {
      // Get schema information
      const schemaInfoQuery = `
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION
      `;
      const schemaInfo = await connectionManager.executeQuery(schemaInfoQuery, [schema]);

      // Extract table and column references from the query
      const tableReferences = extractTableReferences(query);
      const columnReferences = extractColumnReferences(query);

      // Check table references
      const schemaTables = [...new Set(schemaInfo.map((row: any) => row.TABLE_NAME))];
      for (const table of tableReferences) {
        if (!schemaTables.includes(table)) {
          validationResult.warnings.push(`Table '${table}' might not exist in schema '${schema}'`);
        }
      }

      // Check column references
      const schemaColumns = schemaInfo.map((row: any) => ({
        table: row.TABLE_NAME,
        column: row.COLUMN_NAME,
        fullName: `${row.TABLE_NAME}.${row.COLUMN_NAME}`
      }));

      for (const column of columnReferences) {
        const found = schemaColumns.some((sc: any) => sc.column === column || sc.fullName === column);
        if (!found) {
          validationResult.warnings.push(`Column '${column}' might not exist in the schema`);
        }
      }

      // Validate core validation query patterns
      validateCorePatterns(query, validationResult);
    } catch (error: any) {
      ailogger.error('Error during schema validation:', error);
      validationResult.warnings.push('Unable to perform complete schema validation');
    }

    return NextResponse.json(validationResult, { status: HTTPResponses.OK });
  } catch (error: any) {
    ailogger.error('Error validating query:', error);
    return NextResponse.json(
      {
        isValid: false,
        errors: ['Internal server error during validation'],
        warnings: []
      },
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  } finally {
    await connectionManager.closeConnection();
  }
}

// Helper function to extract table references from SQL query
function extractTableReferences(query: string): string[] {
  const tables: string[] = [];

  // Simple regex patterns to find table references
  // This is a basic implementation - a full SQL parser would be more accurate
  const fromPattern = /FROM\s+(\w+)/gi;
  const joinPattern = /JOIN\s+(\w+)/gi;
  const updatePattern = /UPDATE\s+(\w+)/gi;
  const insertPattern = /INSERT\s+INTO\s+(\w+)/gi;
  const deletePattern = /DELETE\s+FROM\s+(\w+)/gi;

  let match;

  const patterns = [fromPattern, joinPattern, updatePattern, insertPattern, deletePattern];

  for (const pattern of patterns) {
    while ((match = pattern.exec(query)) !== null) {
      const tableName = match[1].replace(/`/g, ''); // Remove backticks
      if (!tables.includes(tableName)) {
        tables.push(tableName);
      }
    }
  }

  return tables;
}

// Helper function to extract column references from SQL query
function extractColumnReferences(query: string): string[] {
  const columns: string[] = [];

  // Simple patterns to find column references
  // This is basic - would need a proper SQL parser for complete accuracy
  const selectPattern = /SELECT\s+(.*?)\s+FROM/gi;
  const wherePattern = /WHERE\s+(.*?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+HAVING|\s+LIMIT|$)/gi;
  const columnPattern = /(\w+\.\w+|\w+)/g;

  let match;

  // Extract from SELECT clause
  while ((match = selectPattern.exec(query)) !== null) {
    const selectClause = match[1];
    if (!selectClause.includes('*')) {
      let columnMatch;
      while ((columnMatch = columnPattern.exec(selectClause)) !== null) {
        const col = columnMatch[1].replace(/`/g, '');
        if (!['AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN'].includes(col.toUpperCase())) {
          columns.push(col);
        }
      }
    }
  }

  // Extract from WHERE clause
  while ((match = wherePattern.exec(query)) !== null) {
    const whereClause = match[1];
    let columnMatch;
    while ((columnMatch = columnPattern.exec(whereClause)) !== null) {
      const col = columnMatch[1].replace(/`/g, '');
      if (!['AND', 'OR', 'NOT', 'IN', 'IS', 'NULL'].includes(col.toUpperCase()) && !col.match(/^\d+$/)) {
        columns.push(col);
      }
    }
  }

  return [...new Set(columns)]; // Remove duplicates
}

// Validate that the query follows core validation patterns from corequeries.sql
function validateCorePatterns(query: string, validationResult: ValidationResponse) {
  const queryUpper = query.toUpperCase();
  const queryLower = query.toLowerCase();

  // Check for required INSERT INTO cmverrors structure
  if (!queryUpper.includes('INSERT INTO CMVERRORS')) {
    validationResult.errors.push('Validation queries must INSERT INTO cmverrors table');
  }

  // Check for required CoreMeasurementID and ValidationErrorID columns
  if (!queryUpper.includes('COREMEASUREMENTID') || !queryUpper.includes('VALIDATIONERRORID')) {
    validationResult.errors.push('Query must select CoreMeasurementID and ValidationErrorID columns');
  }

  // Check for required @validationProcedureID parameter
  if (!query.includes('@validationProcedureID')) {
    validationResult.errors.push('Query must use @validationProcedureID as ValidationErrorID value');
  }

  // Check for required plot and census parameters
  if (!query.includes('@p_PlotID') || !query.includes('@p_CensusID')) {
    validationResult.warnings.push('Query should include @p_PlotID and @p_CensusID parameter filters for proper plot/census filtering');
  }

  // Check for IsValidated filter (core requirement)
  if (!queryLower.includes('isvalidated is null')) {
    validationResult.errors.push('Query must filter for cm.IsValidated IS NULL to only process unvalidated records');
  }

  // Check for IsActive filters
  if (!queryLower.includes('isactive')) {
    validationResult.warnings.push('Query should include IsActive filters on relevant tables');
  }

  // Check for duplicate prevention pattern
  if (!queryLower.includes('left join cmverrors e') || !queryLower.includes('e.coremeasurementid is null')) {
    validationResult.warnings.push('Query should include LEFT JOIN cmverrors with e.CoreMeasurementID IS NULL to prevent duplicate error records');
  }

  // Check for proper census join pattern
  if (queryUpper.includes('COREMEASUREMENTS') && !queryUpper.includes('JOIN CENSUS')) {
    validationResult.warnings.push('Validation queries should JOIN census table for plot/census filtering');
  }

  // Check for DISTINCT usage
  if (!queryUpper.includes('SELECT DISTINCT')) {
    validationResult.warnings.push('Consider using SELECT DISTINCT to avoid duplicate error records');
  }
}

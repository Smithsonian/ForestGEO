import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { HTTPResponses } from '@/config/macros';
import { FileRow } from '@/config/macros/formdetails';
import ailogger from '@/ailogger';
import { auth } from '@/auth';
import { isValidSchema, safeFormatQuery } from '@/config/utils/sqlsecurity';
import moment from 'moment/moment';

// Force Node.js runtime for database compatibility
export const runtime = 'nodejs';

interface ValidationIssue {
  rowIndex: number;
  field: string;
  value: any;
  issue: string;
  severity: 'error' | 'warning';
}

interface PrevalidateResponse {
  valid: boolean;
  sampleSize: number;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    checkedFields: string[];
  };
  recommendations: string[];
}

/**
 * Pre-validate a sample of rows before full upload
 * POST /api/prevalidate
 *
 * This endpoint performs early validation checks on sample rows to catch
 * obvious data issues before committing to a full upload. It validates:
 * - Required fields are present
 * - Data types are correct
 * - Foreign key references exist (species codes, quadrats)
 * - Value ranges are reasonable
 */
export async function POST(request: NextRequest) {
  // Authentication check
  const session = await auth();
  if (!session?.user) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: HTTPResponses.UNAUTHORIZED });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(JSON.stringify({ error: 'Invalid JSON body' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const { schema, plotId, sampleRows } = body;

  // Validate required params
  if (!schema || !plotId || !sampleRows || !Array.isArray(sampleRows)) {
    return new NextResponse(JSON.stringify({ error: 'Missing required parameters: schema, plotId, sampleRows (array)' }), {
      status: HTTPResponses.INVALID_REQUEST
    });
  }

  if (!isValidSchema(schema)) {
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), { status: HTTPResponses.INVALID_REQUEST });
  }

  const connectionManager = ConnectionManager.getInstance();
  const issues: ValidationIssue[] = [];
  const recommendations: string[] = [];

  try {
    // Build lookup caches for foreign key validation
    const speciesSQL = safeFormatQuery(schema, 'SELECT SpeciesCode FROM ??.species WHERE SpeciesCode IS NOT NULL');
    const speciesResult = await connectionManager.executeQuery(speciesSQL);
    const validSpeciesCodes = new Set(speciesResult.map((r: any) => r.SpeciesCode?.toLowerCase()));

    const quadratSQL = safeFormatQuery(schema, 'SELECT QuadratName FROM ??.quadrats WHERE PlotID = ?');
    const quadratResult = await connectionManager.executeQuery(quadratSQL, [plotId]);
    const validQuadrats = new Set(quadratResult.map((r: any) => r.QuadratName?.toLowerCase()));

    // Validate each sample row
    sampleRows.forEach((row: FileRow, index: number) => {
      // Required field checks
      if (!row.tag || row.tag.toString().trim() === '') {
        issues.push({ rowIndex: index, field: 'tag', value: row.tag, issue: 'TreeTag is required', severity: 'error' });
      }

      if (!row.spcode || row.spcode.toString().trim() === '') {
        issues.push({ rowIndex: index, field: 'spcode', value: row.spcode, issue: 'Species code is required', severity: 'error' });
      } else if (!validSpeciesCodes.has(row.spcode.toLowerCase())) {
        issues.push({
          rowIndex: index,
          field: 'spcode',
          value: row.spcode,
          issue: `Species code "${row.spcode}" not found in database`,
          severity: 'error'
        });
      }

      if (!row.quadrat || row.quadrat.toString().trim() === '') {
        issues.push({ rowIndex: index, field: 'quadrat', value: row.quadrat, issue: 'Quadrat is required', severity: 'error' });
      } else if (validQuadrats.size > 0 && !validQuadrats.has(row.quadrat.toLowerCase())) {
        issues.push({
          rowIndex: index,
          field: 'quadrat',
          value: row.quadrat,
          issue: `Quadrat "${row.quadrat}" not found for this plot`,
          severity: 'warning'
        });
      }

      // Numeric field validation
      if (row.dbh !== undefined && row.dbh !== null && row.dbh !== '') {
        const dbhNum = Number(row.dbh);
        if (isNaN(dbhNum)) {
          issues.push({ rowIndex: index, field: 'dbh', value: row.dbh, issue: 'DBH must be a number', severity: 'error' });
        } else if (dbhNum < 0) {
          issues.push({ rowIndex: index, field: 'dbh', value: row.dbh, issue: 'DBH cannot be negative', severity: 'error' });
        } else if (dbhNum > 5000) {
          issues.push({ rowIndex: index, field: 'dbh', value: row.dbh, issue: 'DBH value unusually large (>5000mm)', severity: 'warning' });
        }
      }

      if (row.hom !== undefined && row.hom !== null && row.hom !== '') {
        const homNum = Number(row.hom);
        if (isNaN(homNum)) {
          issues.push({ rowIndex: index, field: 'hom', value: row.hom, issue: 'HOM must be a number', severity: 'error' });
        } else if (homNum < 0) {
          issues.push({ rowIndex: index, field: 'hom', value: row.hom, issue: 'HOM cannot be negative', severity: 'error' });
        }
      }

      if (row.lx !== undefined && row.lx !== null && row.lx !== '') {
        const lxNum = Number(row.lx);
        if (isNaN(lxNum)) {
          issues.push({ rowIndex: index, field: 'lx', value: row.lx, issue: 'LocalX must be a number', severity: 'error' });
        }
      }

      if (row.ly !== undefined && row.ly !== null && row.ly !== '') {
        const lyNum = Number(row.ly);
        if (isNaN(lyNum)) {
          issues.push({ rowIndex: index, field: 'ly', value: row.ly, issue: 'LocalY must be a number', severity: 'error' });
        }
      }

      // Date validation
      if (row.date) {
        const parsedDate = moment(row.date);
        if (!parsedDate.isValid()) {
          issues.push({ rowIndex: index, field: 'date', value: row.date, issue: 'Invalid date format', severity: 'error' });
        } else if (parsedDate.isAfter(moment())) {
          issues.push({ rowIndex: index, field: 'date', value: row.date, issue: 'Date is in the future', severity: 'warning' });
        } else if (parsedDate.isBefore(moment('1900-01-01'))) {
          issues.push({ rowIndex: index, field: 'date', value: row.date, issue: 'Date is before 1900', severity: 'warning' });
        }
      }
    });

    // Generate recommendations based on issues found
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (errorCount > 0) {
      recommendations.push(`Found ${errorCount} error(s) that will prevent successful upload. Please fix these before proceeding.`);
    }

    const missingSpecies = issues.filter(i => i.field === 'spcode' && i.issue.includes('not found'));
    if (missingSpecies.length > 0) {
      const uniqueSpecies = [...new Set(missingSpecies.map(i => i.value))];
      recommendations.push(
        `Missing species codes: ${uniqueSpecies.slice(0, 5).join(', ')}${uniqueSpecies.length > 5 ? ` and ${uniqueSpecies.length - 5} more` : ''}`
      );
    }

    const missingQuadrats = issues.filter(i => i.field === 'quadrat' && i.issue.includes('not found'));
    if (missingQuadrats.length > 0) {
      const uniqueQuadrats = [...new Set(missingQuadrats.map(i => i.value))];
      recommendations.push(
        `Missing quadrats: ${uniqueQuadrats.slice(0, 5).join(', ')}${uniqueQuadrats.length > 5 ? ` and ${uniqueQuadrats.length - 5} more` : ''}`
      );
    }

    const response: PrevalidateResponse = {
      valid: errorCount === 0,
      sampleSize: sampleRows.length,
      issues,
      summary: {
        errors: errorCount,
        warnings: warningCount,
        checkedFields: ['tag', 'spcode', 'quadrat', 'dbh', 'hom', 'lx', 'ly', 'date']
      },
      recommendations
    };

    ailogger.info(`Pre-validation for ${schema} plot ${plotId}: ${sampleRows.length} rows checked, ${errorCount} errors, ${warningCount} warnings`);

    return new NextResponse(JSON.stringify(response), {
      status: errorCount > 0 ? HTTPResponses.INVALID_REQUEST : HTTPResponses.OK
    });
  } catch (error: any) {
    ailogger.error('Pre-validation error:', error);
    return new NextResponse(
      JSON.stringify({
        valid: false,
        error: 'Pre-validation failed',
        details: error.message
      }),
      { status: HTTPResponses.INTERNAL_SERVER_ERROR }
    );
  }
}

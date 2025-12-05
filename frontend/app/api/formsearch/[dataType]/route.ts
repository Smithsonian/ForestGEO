import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import { HTTPResponses } from '@/config/macros';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import ailogger from '@/ailogger';

// Force Node.js runtime for database and Azure SDK compatibility
// mysql2 and @azure/storage-* are not compatible with Edge Runtime
export const runtime = 'nodejs';

// Whitelist of allowed data types for this route
const ALLOWED_DATA_TYPES = ['personnel', 'species', 'quadrats'] as const;
type AllowedDataType = (typeof ALLOWED_DATA_TYPES)[number];

function isValidDataType(dataType: string): dataType is AllowedDataType {
  return ALLOWED_DATA_TYPES.includes(dataType.toLowerCase() as AllowedDataType);
}

/**
 * GET endpoint for autocomplete search functionality
 * Returns a simple array of strings matching the search criteria
 *
 * Query parameters:
 * - schema: Database schema name
 * - searchfor: Search string to filter results
 */
export async function GET(
  request: NextRequest,
  props: {
    params: Promise<{ dataType: string }>;
  }
): Promise<NextResponse<string[]>> {
  const params = await props.params;
  const { searchParams } = new URL(request.url);
  const schema = searchParams.get('schema');
  const searchFor = searchParams.get('searchfor') || '';

  if (!schema) {
    return new NextResponse(JSON.stringify({ error: 'Schema parameter is required' }), {
      status: HTTPResponses.BAD_REQUEST
    });
  }

  // SECURITY: Validate schema against whitelist to prevent SQL injection
  if (!isValidSchema(schema)) {
    ailogger.error(`[formsearch API] Invalid schema provided: ${schema}`);
    return new NextResponse(JSON.stringify({ error: 'Invalid schema' }), {
      status: HTTPResponses.BAD_REQUEST
    });
  }

  // SECURITY: Validate dataType against whitelist
  if (!isValidDataType(params.dataType)) {
    ailogger.error(`[formsearch API] Invalid dataType provided: ${params.dataType}`);
    return new NextResponse(JSON.stringify({ error: `Unsupported dataType: ${params.dataType}` }), {
      status: HTTPResponses.BAD_REQUEST
    });
  }

  const connectionManager = ConnectionManager.getInstance();

  try {
    let query = '';
    const queryParams: any[] = [];

    switch (params.dataType.toLowerCase()) {
      case 'personnel':
        // Return FirstName + LastName concatenated for personnel
        if (searchFor) {
          query = `
            SELECT DISTINCT CONCAT(FirstName, ' ', LastName) AS DisplayName
            FROM ${schema}.personnel
            WHERE CONCAT(FirstName, ' ', LastName) LIKE ?
            ORDER BY DisplayName
            LIMIT 100`;
          queryParams.push(`%${searchFor}%`);
        } else {
          query = `
            SELECT DISTINCT CONCAT(FirstName, ' ', LastName) AS DisplayName
            FROM ${schema}.personnel
            ORDER BY DisplayName
            LIMIT 100`;
        }
        break;

      case 'species':
        // Return species codes for species autocomplete
        if (searchFor) {
          query = `
            SELECT DISTINCT SpeciesCode
            FROM ${schema}.species
            WHERE SpeciesCode LIKE ?
            ORDER BY SpeciesCode
            LIMIT 100`;
          queryParams.push(`%${searchFor}%`);
        } else {
          query = `
            SELECT DISTINCT SpeciesCode
            FROM ${schema}.species
            ORDER BY SpeciesCode
            LIMIT 100`;
        }
        break;

      case 'quadrats':
        // Return quadrat names
        if (searchFor) {
          query = `
            SELECT DISTINCT QuadratName
            FROM ${schema}.quadrats
            WHERE QuadratName LIKE ? AND IsActive IS TRUE
            ORDER BY QuadratName
            LIMIT 100`;
          queryParams.push(`%${searchFor}%`);
        } else {
          query = `
            SELECT DISTINCT QuadratName
            FROM ${schema}.quadrats
            WHERE IsActive IS TRUE
            ORDER BY QuadratName
            LIMIT 100`;
        }
        break;

      default:
        return new NextResponse(JSON.stringify({ error: `Unsupported dataType: ${params.dataType}` }), {
          status: HTTPResponses.BAD_REQUEST
        });
    }

    const results = await connectionManager.executeQuery(format(query, queryParams));

    // Extract the values from the result objects into a simple string array
    const values = results
      .map((row: any) => {
        // Get the first property value from each row object
        const firstKey = Object.keys(row)[0];
        return row[firstKey];
      })
      .filter((value: any) => value !== null && value !== undefined);

    return new NextResponse(JSON.stringify(values), {
      status: HTTPResponses.OK,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    ailogger.error(`[formsearch API] Error in ${params.dataType}:`, err);
    return new NextResponse(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: HTTPResponses.INTERNAL_SERVER_ERROR
    });
  } finally {
    await connectionManager.closeConnection();
  }
}

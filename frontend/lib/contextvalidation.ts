import { NextRequest, NextResponse } from 'next/server';
import { getCookie } from '@/app/actions/cookiemanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';
import { isValidSchema } from '@/config/utils/sqlsecurity';

export interface ContextValues {
  siteID?: number;
  plotID?: number;
  censusID?: number;
  schema?: string;
  quadratID?: number;
}

/**
 * Helper to extract an integer value from query params with cookie fallback
 * Consolidates the repeated pattern of checking params -> cookies -> returning number
 */
async function extractIntegerValue(request: NextRequest, paramName: string, cookieName: string): Promise<number | undefined> {
  const paramValue = request.nextUrl.searchParams.get(paramName);
  if (paramValue && paramValue !== '0' && paramValue !== 'undefined') {
    const parsed = parseInt(paramValue, 10);
    if (!isNaN(parsed)) return parsed;
  }
  const cookieValue = await getCookie(cookieName);
  if (cookieValue && cookieValue !== '0' && cookieValue !== 'undefined') {
    const parsed = parseInt(cookieValue, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Helper to extract a string value from query params with cookie fallback
 * Note: Currently unused but kept for future use with schema extraction
 */
async function _extractStringValue(request: NextRequest, paramName: string, cookieName: string): Promise<string | undefined> {
  const paramValue = request.nextUrl.searchParams.get(paramName);
  if (paramValue && paramValue !== 'undefined') {
    return paramValue;
  }
  const cookieValue = await getCookie(cookieName);
  if (cookieValue && cookieValue !== 'undefined') {
    return cookieValue;
  }
  return undefined;
}

export interface ValidationOptions {
  requireSite?: boolean;
  requirePlot?: boolean;
  requireCensus?: boolean;
  requireSchema?: boolean;
  requireQuadrat?: boolean;
  allowFallback?: boolean;
  fallbackMessage?: string;
}

/**
 * Validates and retrieves contextual values from cookies with graceful error handling
 */
export async function validateContextualValues(
  request: NextRequest,
  options: ValidationOptions = {}
): Promise<{
  success: boolean;
  values?: ContextValues;
  response?: NextResponse;
  missing?: string[];
}> {
  const {
    requireSite = false,
    requirePlot = false,
    requireCensus = false,
    requireSchema = false,
    requireQuadrat = false,
    allowFallback = true,
    fallbackMessage = 'Please ensure all required selections are made before proceeding.'
  } = options;

  try {
    const values: ContextValues = {};
    const missing: string[] = [];

    // Get schema from query params or cookies
    const schemaParam = request.nextUrl.searchParams.get('schema');
    if (schemaParam && schemaParam !== 'undefined') {
      // SECURITY: Validate schema against whitelist to prevent SQL injection
      if (!isValidSchema(schemaParam)) {
        ailogger.error(`[contextvalidation] Invalid schema provided: ${schemaParam}`);
        return {
          success: false,
          missing: ['schema'],
          response: NextResponse.json({ error: 'Invalid schema provided', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.BAD_REQUEST })
        };
      }
      values.schema = schemaParam;
    } else {
      const schemaCookie = await getCookie('schema');
      if (schemaCookie && schemaCookie !== 'undefined') {
        // SECURITY: Also validate schema from cookies
        if (!isValidSchema(schemaCookie)) {
          ailogger.error(`[contextvalidation] Invalid schema in cookie: ${schemaCookie}`);
          return {
            success: false,
            missing: ['schema'],
            response: NextResponse.json({ error: 'Invalid schema in session', code: 'INVALID_SCHEMA' }, { status: HTTPResponses.BAD_REQUEST })
          };
        }
        values.schema = schemaCookie;
      }
    }

    // Get plotID, censusID, and quadratID using helper function
    values.plotID = await extractIntegerValue(request, 'plotID', 'plotID');
    values.censusID = await extractIntegerValue(request, 'censusID', 'censusID');
    values.quadratID = await extractIntegerValue(request, 'quadratID', 'quadratID');

    // Get siteID from query params or cookies (similar to other values)
    values.siteID = await extractIntegerValue(request, 'siteID', 'siteID');

    // Check requirements
    if (requireSchema && !values.schema) missing.push('schema/site selection');
    if (requireSite && !values.siteID) missing.push('site');
    if (requirePlot && !values.plotID) missing.push('plot');
    if (requireCensus && !values.censusID) missing.push('census');
    if (requireQuadrat && !values.quadratID) missing.push('quadrat');

    if (missing.length > 0) {
      const message = allowFallback ? `${fallbackMessage} Missing: ${missing.join(', ')}` : `Required values missing: ${missing.join(', ')}`;

      ailogger.warn(`Context validation failed: ${message}`, { missing, values });

      if (allowFallback) {
        return {
          success: false,
          missing,
          response: NextResponse.json(
            {
              error: message,
              missing,
              fallback: true,
              values: values // Return partial values for potential recovery
            },
            { status: HTTPResponses.BAD_REQUEST }
          )
        };
      } else {
        return {
          success: false,
          missing,
          response: NextResponse.json({ error: message, missing }, { status: HTTPResponses.BAD_REQUEST })
        };
      }
    }

    return { success: true, values };
  } catch (error: any) {
    ailogger.error('Context validation error:', error);
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Failed to validate context values',
          details: error.message,
          fallback: allowFallback
        },
        { status: HTTPResponses.INTERNAL_SERVER_ERROR }
      )
    };
  }
}

/**
 * Middleware wrapper for API routes that require contextual values
 */
export function withContextValidation(
  handler: (request: NextRequest, context: any, values: ContextValues) => Promise<NextResponse>,
  options: ValidationOptions = {}
) {
  return async (request: NextRequest, context: any) => {
    const validation = await validateContextualValues(request, options);

    if (!validation.success) {
      return validation.response!;
    }

    try {
      return await handler(request, context, validation.values!);
    } catch (error: any) {
      ailogger.error('Handler error with context validation:', error);
      return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    }
  };
}

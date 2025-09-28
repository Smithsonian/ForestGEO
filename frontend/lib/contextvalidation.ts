import { NextRequest, NextResponse } from 'next/server';
import { getCookie } from '@/app/actions/cookiemanager';
import { HTTPResponses } from '@/config/macros';
import ailogger from '@/ailogger';

export interface ContextValues {
  siteID?: number;
  plotID?: number;
  censusID?: number;
  schema?: string;
  quadratID?: number;
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
      values.schema = schemaParam;
    } else {
      const schemaCookie = await getCookie('schema');
      if (schemaCookie && schemaCookie !== 'undefined') {
        values.schema = schemaCookie;
      }
    }

    // Get plotID from cookies
    const plotIDCookie = await getCookie('plotID');
    if (plotIDCookie && plotIDCookie !== '0' && plotIDCookie !== 'undefined') {
      values.plotID = parseInt(plotIDCookie);
    }

    // Get censusID from cookies
    const censusIDCookie = await getCookie('censusID');
    if (censusIDCookie && censusIDCookie !== '0' && censusIDCookie !== 'undefined') {
      values.censusID = parseInt(censusIDCookie);
    }

    // Get quadratID from cookies (optional)
    const quadratIDCookie = await getCookie('quadratID');
    if (quadratIDCookie && quadratIDCookie !== '0' && quadratIDCookie !== 'undefined') {
      values.quadratID = parseInt(quadratIDCookie);
    }

    // Determine siteID from schema (if available)
    if (values.schema) {
      // You may need to adjust this logic based on your schema naming convention
      values.siteID = 1; // Placeholder - adjust based on actual site determination logic
    }

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

import { HTTPResponses } from '@/config/macros';
import { NextRequest, NextResponse } from 'next/server';
import ConnectionManager from '@/config/connectionmanager';

type ValidationProcedure = {
  ValidationID: number;
  ProcedureName: string;
  Description: string;
  Definition: string;
};

type SiteSpecificValidations = {
  ValidationProcedureID: number;
  Name: string;
  Description: string;
  Definition: string;
};

type ValidationMessages = {
  [key: string]: { id: number; description: string; definition: string };
};

export async function GET(request: NextRequest): Promise<NextResponse<ValidationMessages>> {
  const conn = new ConnectionManager();
  const schema = request.nextUrl.searchParams.get('schema');
  if (!schema) throw new Error('No schema variable provided!');
  try {
    const query = `SELECT ValidationID, ProcedureName, Description, Definition FROM catalog.validationprocedures WHERE IsEnabled IS TRUE;`;
    const results: ValidationProcedure[] = await conn.executeQuery(query);

    const customQuery = `SELECT ValidationProcedureID, Name, Description, Definition FROM ${schema}.sitespecificvalidations WHERE IsEnabled IS TRUE;`;
    const customResults: SiteSpecificValidations[] = await conn.executeQuery(customQuery);

    const validationMessages: ValidationMessages = results.reduce((acc, { ValidationID, ProcedureName, Description, Definition }) => {
      acc[ProcedureName] = { id: ValidationID, description: Description, definition: Definition };
      return acc;
    }, {} as ValidationMessages);

    const siteValidationMessages: ValidationMessages = customResults.reduce((acc, { ValidationProcedureID, Name, Description, Definition }) => {
      acc[Name] = { id: ValidationProcedureID, description: Description, definition: Definition };
      return acc;
    }, {} as ValidationMessages);
    return new NextResponse(JSON.stringify({ coreValidations: validationMessages, siteValidations: siteValidationMessages }), {
      status: HTTPResponses.OK,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Error in GET request:', error.message);
    await conn.rollbackTransaction();
    return new NextResponse(JSON.stringify({ error: error.message }), {
      status: 500
    });
  } finally {
    await conn.closeConnection();
  }
}

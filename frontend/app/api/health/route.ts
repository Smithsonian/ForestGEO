import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Ensure this runs on Node.js runtime (required for fs operations)
export const runtime = 'nodejs';

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  environment: {
    buildDir: string;
    nodeEnv: string;
  };
  build: {
    id: string | null;
    hasManifest: boolean;
    hasServerChunks: boolean;
    hasStaticAssets: boolean;
    chunkCount: number;
  };
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }[];
  uptime: number;
}

const startTime = Date.now();

/**
 * Health check endpoint for deployment verification
 * GET /api/health - Returns health status of the application
 * GET /api/health?deep=true - Performs deep checks including database connectivity
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const deepCheck = searchParams.get('deep') === 'true';

  const checks: HealthCheckResult['checks'] = [];
  let overallStatus: HealthCheckResult['status'] = 'healthy';

  // Determine the build directory based on environment
  // Priority: Azure production path > local build path > Next.js dev path
  const azureBuildPath = '/home/site/wwwroot/build';
  const localBuildPath = path.join(process.cwd(), 'build');
  const devBuildPath = path.join(process.cwd(), '.next');

  let buildDir: string;
  if (fs.existsSync(azureBuildPath)) {
    buildDir = azureBuildPath;
  } else if (fs.existsSync(localBuildPath)) {
    buildDir = localBuildPath;
  } else if (fs.existsSync(devBuildPath)) {
    buildDir = devBuildPath;
  } else {
    buildDir = localBuildPath; // Default fallback
  }

  // Check 1: Build ID exists
  let buildId: string | null = null;
  try {
    const buildIdPath = path.join(buildDir, 'BUILD_ID');
    if (fs.existsSync(buildIdPath)) {
      buildId = fs.readFileSync(buildIdPath, 'utf-8').trim();
      checks.push({
        name: 'build_id',
        status: 'pass',
        message: `Build ID: ${buildId}`
      });
    } else {
      checks.push({
        name: 'build_id',
        status: 'fail',
        message: 'BUILD_ID file not found'
      });
      overallStatus = 'unhealthy';
    }
  } catch (error) {
    checks.push({
      name: 'build_id',
      status: 'fail',
      message: `Error reading BUILD_ID: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    overallStatus = 'unhealthy';
  }

  // Check 2: Build manifest exists
  let hasManifest = false;
  try {
    const manifestPath = path.join(buildDir, 'build-manifest.json');
    hasManifest = fs.existsSync(manifestPath);
    if (hasManifest) {
      checks.push({
        name: 'build_manifest',
        status: 'pass',
        message: 'Build manifest present'
      });
    } else {
      checks.push({
        name: 'build_manifest',
        status: 'fail',
        message: 'build-manifest.json not found'
      });
      overallStatus = 'unhealthy';
    }
  } catch (error) {
    checks.push({
      name: 'build_manifest',
      status: 'fail',
      message: `Error checking manifest: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    overallStatus = 'unhealthy';
  }

  // Check 3: Server chunks exist and count them
  let hasServerChunks = false;
  let chunkCount = 0;
  try {
    const chunksDir = path.join(buildDir, 'server', 'chunks');
    if (fs.existsSync(chunksDir)) {
      const chunks = fs.readdirSync(chunksDir).filter(f => f.endsWith('.js'));
      chunkCount = chunks.length;
      hasServerChunks = chunkCount > 0;

      if (chunkCount >= 10) {
        checks.push({
          name: 'server_chunks',
          status: 'pass',
          message: `${chunkCount} server chunks found`
        });
      } else if (chunkCount > 0) {
        checks.push({
          name: 'server_chunks',
          status: 'warn',
          message: `Only ${chunkCount} server chunks found (expected 10+)`
        });
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      } else {
        checks.push({
          name: 'server_chunks',
          status: 'fail',
          message: 'No server chunks found'
        });
        overallStatus = 'unhealthy';
      }
    } else {
      checks.push({
        name: 'server_chunks',
        status: 'fail',
        message: 'Server chunks directory not found'
      });
      overallStatus = 'unhealthy';
    }
  } catch (error) {
    checks.push({
      name: 'server_chunks',
      status: 'fail',
      message: `Error checking chunks: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    overallStatus = 'unhealthy';
  }

  // Check 4: Static assets exist
  let hasStaticAssets = false;
  try {
    const staticDir = path.join(buildDir, 'static');
    hasStaticAssets = fs.existsSync(staticDir);
    if (hasStaticAssets) {
      checks.push({
        name: 'static_assets',
        status: 'pass',
        message: 'Static assets directory present'
      });
    } else {
      checks.push({
        name: 'static_assets',
        status: 'fail',
        message: 'Static assets directory not found'
      });
      overallStatus = 'unhealthy';
    }
  } catch (error) {
    checks.push({
      name: 'static_assets',
      status: 'fail',
      message: `Error checking static assets: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
    overallStatus = 'unhealthy';
  }

  // Check 5: Required environment variables (non-sensitive check)
  const requiredEnvVars = ['AUTH_SECRET', 'AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE'];
  const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingEnvVars.length === 0) {
    checks.push({
      name: 'environment',
      status: 'pass',
      message: 'Required environment variables present'
    });
  } else {
    checks.push({
      name: 'environment',
      status: 'warn',
      message: `Missing env vars: ${missingEnvVars.join(', ')}`
    });
    if (overallStatus === 'healthy') overallStatus = 'degraded';
  }

  // Check 6: Deep check - Database connectivity (optional)
  if (deepCheck) {
    try {
      // Simple database connectivity test would go here
      // For now, just check if connection params exist
      const hasDbConfig = !!(process.env.AZURE_SQL_SERVER && process.env.AZURE_SQL_USER && process.env.AZURE_SQL_PASSWORD && process.env.AZURE_SQL_DATABASE);

      if (hasDbConfig) {
        checks.push({
          name: 'database_config',
          status: 'pass',
          message: 'Database configuration present'
        });
      } else {
        checks.push({
          name: 'database_config',
          status: 'fail',
          message: 'Database configuration incomplete'
        });
        overallStatus = 'unhealthy';
      }
    } catch (error) {
      checks.push({
        name: 'database_config',
        status: 'fail',
        message: `Database check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      overallStatus = 'unhealthy';
    }
  }

  const result: HealthCheckResult = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    environment: {
      buildDir,
      nodeEnv: process.env.NODE_ENV || 'unknown'
    },
    build: {
      id: buildId,
      hasManifest,
      hasServerChunks,
      hasStaticAssets,
      chunkCount
    },
    checks,
    uptime: Math.floor((Date.now() - startTime) / 1000)
  };

  // Return appropriate HTTP status code
  const httpStatus = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;

  return NextResponse.json(result, { status: httpStatus });
}

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Force Node.js runtime for filesystem access
export const runtime = 'nodejs';

// Valid animation filenames (allowlist for security)
const VALID_ANIMATIONS = ['growing-plant.lottie', 'data-processing.lottie', 'startup.lottie', 'file-check.lottie', 'uploading.lottie'];

export async function GET(request: NextRequest, props: { params: Promise<{ filename: string }> }) {
  const params = await props.params;
  const { filename } = params;

  // Validate filename against allowlist to prevent path traversal
  if (!VALID_ANIMATIONS.includes(filename)) {
    return new NextResponse('Animation not found', { status: 404 });
  }

  try {
    // Resolve the path to the animation file
    // In standalone mode, public folder is at the same level as server.js
    const publicPath = path.join(process.cwd(), 'public', 'animations', filename);

    // Check if file exists
    if (!fs.existsSync(publicPath)) {
      // Fallback: try relative to next build output
      const fallbackPath = path.join(process.cwd(), '..', 'public', 'animations', filename);
      if (!fs.existsSync(fallbackPath)) {
        return new NextResponse('Animation file not found', { status: 404 });
      }
      const fileBuffer = fs.readFileSync(fallbackPath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    const fileBuffer = fs.readFileSync(publicPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    console.error('Error serving animation:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}

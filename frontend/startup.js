/**
 * Environment loader for Next.js standalone server
 * This module loads environment variables from .env file at runtime.
 *
 * This is required because Next.js standalone mode doesn't include
 * a dotenv loader, and Azure App Service needs server-side env vars.
 */

const fs = require('fs');
const path = require('path');

// Load .env file if it exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) return;

    const [key, ...valueParts] = trimmedLine.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('='); // Handle values that contain '='
      // Only set if not already set (allows Azure App Settings to override)
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
  console.log('✅ Environment variables loaded from .env file');
} else {
  console.log('ℹ️ No .env file found, using existing environment variables');
}

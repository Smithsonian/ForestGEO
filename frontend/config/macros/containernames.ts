/**
 * Container Naming Utilities for Azure Storage
 *
 * Provides consistent, ID-based container naming for file storage.
 * Uses plot IDs and census numbers instead of plot names to ensure:
 * - Uniqueness and stability (IDs never change)
 * - URL safety (no special characters)
 * - Azure container naming compliance
 * - Database normalization best practices
 */

import ailogger from '@/ailogger';

/**
 * Generate a standardized container name using plot ID and census number
 *
 * Format: plot{plotID}-census{censusNumber}
 * Example: "plot1-census1", "plot42-census3"
 *
 * @param plotID - The unique plot identifier
 * @param censusNumber - The census number
 * @returns Formatted container name
 * @throws Error if plotID or censusNumber are invalid
 */
export function getContainerName(plotID: number, censusNumber: number): string {
  if (!plotID || plotID <= 0) {
    throw new Error(`Invalid plotID: ${plotID}. Must be a positive number.`);
  }
  if (!censusNumber || censusNumber <= 0) {
    throw new Error(`Invalid censusNumber: ${censusNumber}. Must be a positive number.`);
  }

  const containerName = `plot${plotID}-census${censusNumber}`;

  // Validate Azure container naming requirements
  if (!validateContainerName(containerName)) {
    throw new Error(`Generated container name "${containerName}" is invalid`);
  }

  return containerName;
}

/**
 * Generate legacy container name using plot name and census number
 *
 * THIS IS FOR BACKWARD COMPATIBILITY ONLY
 * Used to access containers created before the ID-based migration
 *
 * @deprecated Use getContainerName() with plot IDs instead
 * @param plotName - The plot name (will be trimmed and lowercased)
 * @param censusNumber - The census number
 * @returns Legacy formatted container name
 */
export function getLegacyContainerName(plotName: string, censusNumber: number): string {
  if (!plotName || plotName.trim() === '') {
    throw new Error('Invalid plotName: cannot be empty');
  }
  if (!censusNumber || censusNumber <= 0) {
    throw new Error(`Invalid censusNumber: ${censusNumber}. Must be a positive number.`);
  }

  // Sanitize plot name for Azure container requirements
  const sanitized = sanitizePlotNameForContainer(plotName.trim());
  return `${sanitized}-${censusNumber}`;
}

/**
 * Sanitize a plot name to meet Azure container naming requirements
 * - Lowercase only
 * - Replace spaces and special chars with hyphens
 * - Remove consecutive hyphens
 * - Ensure doesn't start/end with hyphen
 *
 * @param plotName - The plot name to sanitize
 * @returns Sanitized name safe for container usage
 */
function sanitizePlotNameForContainer(plotName: string): string {
  return plotName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace invalid chars with hyphen
    .replace(/-+/g, '-') // Remove consecutive hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Validate a container name meets Azure Storage requirements
 *
 * Azure container names must:
 * - Be 3-63 characters long
 * - Contain only lowercase letters, numbers, and hyphens
 * - Start with a letter or number
 * - Not contain consecutive hyphens
 * - Not end with a hyphen
 *
 * @param name - Container name to validate
 * @returns true if valid, false otherwise
 */
export function validateContainerName(name: string): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }

  // Check length
  if (name.length < 3 || name.length > 63) {
    return false;
  }

  // Check format
  const validPattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
  if (!validPattern.test(name)) {
    return false;
  }

  // Check for consecutive hyphens
  if (name.includes('--')) {
    return false;
  }

  return true;
}

/**
 * Parse a container name to extract plot ID and census number
 *
 * @param containerName - The container name to parse
 * @returns Object with plotID and censusNumber, or null if invalid
 */
export function parseContainerName(containerName: string): { plotID: number; censusNumber: number } | null {
  const match = containerName.match(/^plot(\d+)-census(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    plotID: parseInt(match[1], 10),
    censusNumber: parseInt(match[2], 10)
  };
}

/**
 * Attempt to get container name with fallback to legacy naming
 *
 * This function provides backward compatibility by trying the new ID-based
 * naming first, then falling back to legacy name-based naming.
 *
 * @param plotID - The unique plot identifier
 * @param plotName - The plot name (for legacy fallback)
 * @param censusNumber - The census number
 * @returns Object with primary container name and optional legacy fallback
 */
export function getContainerNameWithFallback(
  plotID: number | undefined,
  plotName: string | undefined,
  censusNumber: number | undefined
): { primary: string; legacy?: string; usesLegacy: boolean } {
  // Try to generate new ID-based name
  if (plotID && censusNumber && plotID > 0 && censusNumber > 0) {
    try {
      const primary = getContainerName(plotID, censusNumber);

      // Also generate legacy name for fallback if plot name is available
      let legacy: string | undefined;
      if (plotName && plotName.trim() !== '') {
        try {
          legacy = getLegacyContainerName(plotName, censusNumber);
        } catch (error) {
          ailogger.warn(`Could not generate legacy container name for plot "${plotName}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return { primary, legacy, usesLegacy: false };
    } catch (error) {
      ailogger.error(`Error generating ID-based container name: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Fall back to legacy naming if ID-based fails
  if (plotName && plotName.trim() !== '' && censusNumber && censusNumber > 0) {
    try {
      const legacy = getLegacyContainerName(plotName, censusNumber);
      ailogger.warn(`Using legacy container naming for plot "${plotName}". Consider migrating to ID-based naming.`);
      return { primary: legacy, usesLegacy: true };
    } catch (error) {
      ailogger.error(`Error generating legacy container name: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Cannot generate container name. Need either (plotID: ${plotID}, censusNumber: ${censusNumber}) ` +
      `or (plotName: "${plotName}", censusNumber: ${censusNumber})`
  );
}

/**
 * Check if a container name uses the new ID-based format
 *
 * @param containerName - The container name to check
 * @returns true if using new format, false if legacy or invalid
 */
export function isIdBasedContainerName(containerName: string): boolean {
  return /^plot\d+-census\d+$/.test(containerName);
}

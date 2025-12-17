'use client';

/**
 * Animation Cache Utility (Simplified)
 *
 * Uses direct public folder paths for Lottie animations.
 * Files in /public/animations/ are served at /animations/ by Next.js.
 *
 * This approach:
 * - Uses browser's native HTTP cache (no IndexedDB complexity)
 * - Works reliably in all deployment modes (dev, production, standalone)
 * - Preloads animations on login to warm the browser cache
 */

// List of all animations used in the upload system
export const ANIMATION_FILES = ['growing-plant.lottie', 'data-processing.lottie', 'startup.lottie', 'file-check.lottie', 'uploading.lottie'] as const;

export type AnimationName = (typeof ANIMATION_FILES)[number];

/**
 * Gets the URL for an animation file.
 * Uses direct public folder path (not API route).
 */
export function getAnimationPath(name: AnimationName): string {
  return `/animations/${name}`;
}

/**
 * Preloads all animations by fetching them.
 * This warms the browser's HTTP cache so animations load instantly during upload.
 * Should be called after successful login.
 */
export async function preloadAnimations(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  const total = ANIMATION_FILES.length;
  let loaded = 0;

  await Promise.all(
    ANIMATION_FILES.map(async name => {
      try {
        // Fetch to warm browser cache - response is discarded
        await fetch(getAnimationPath(name), {
          // Use cache: 'force-cache' to ensure browser caches the response
          cache: 'force-cache'
        });
      } catch (error) {
        // Log but don't fail - animations will load on demand if preload fails
        console.warn(`Failed to preload animation ${name}:`, error);
      } finally {
        loaded++;
        onProgress?.(loaded, total);
      }
    })
  );
}

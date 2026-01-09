import { useEffect, useRef, useCallback } from 'react';

/**
 * useIsMounted Hook
 *
 * Provides a way to track whether a component is still mounted,
 * useful for preventing state updates after unmount in async operations.
 *
 * This pattern is especially important for:
 * - Async fetch operations that may complete after component unmount
 * - React 18 Strict Mode's double-effect execution
 * - Preventing "Can't perform a React state update on an unmounted component" warnings
 *
 * @returns Object with:
 *   - isMountedRef: A ref that is true while mounted, false after unmount
 *   - isMounted: A function that returns the current mounted state (useful in closures)
 *
 * @example
 * const { isMountedRef, isMounted } = useIsMounted();
 *
 * useEffect(() => {
 *   async function fetchData() {
 *     const data = await api.getData();
 *     if (isMountedRef.current) {
 *       setData(data);
 *     }
 *   }
 *   fetchData();
 * }, []);
 *
 * // Or using the function form in callbacks:
 * const handleClick = async () => {
 *   const result = await api.doSomething();
 *   if (isMounted()) {
 *     setResult(result);
 *   }
 * };
 */
export function useIsMounted(): {
  isMountedRef: React.MutableRefObject<boolean>;
  isMounted: () => boolean;
} {
  // Start as false - will be set to true after first render/mount
  // This prevents state updates during the initial render phase
  const isMountedRef = useRef<boolean>(false);

  useEffect(() => {
    // Component has mounted - safe to update state now
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isMounted = useCallback(() => isMountedRef.current, []);

  return { isMountedRef, isMounted };
}

export default useIsMounted;

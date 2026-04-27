'use client';
import * as React from 'react';
import Link, { LinkProps } from 'next/link';
import { preloadKey } from '@/lib/query/preload';
import type { QueryKey } from '@/lib/query/queryKey';

export interface PrefetchLinkProps extends LinkProps {
  prefetchKey?: QueryKey;
  prefetchURL?: string;
  children: React.ReactNode;
  className?: string;
}

export function PrefetchLink({ prefetchKey: prefetchKeyValue, prefetchURL, children, ...linkProps }: PrefetchLinkProps) {
  const handle = React.useCallback(() => {
    if (prefetchKeyValue && prefetchURL) preloadKey(prefetchKeyValue, prefetchURL);
  }, [prefetchKeyValue, prefetchURL]);

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Next <Link> renders a native <a>, but the wrapper props confuse the rule.
    <Link {...linkProps} onMouseEnter={handle} onFocus={handle}>
      {children}
    </Link>
  );
}

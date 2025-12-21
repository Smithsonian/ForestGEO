/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// MDX component types for better autocomplete
declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types';
  export default function MDXContent(props: MDXProps): JSX.Element;
}

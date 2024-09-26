import * as React from 'react';
import { SVGProps } from 'react';
import { IconSvgProps } from '@/types';

export const CensusLogo: React.FC<SVGProps<SVGSVGElement> & { size?: string }> = ({
  size = '1em', // default size is 1em, it can be overridden
  ...props
}) => (
  <svg viewBox="0 0 15 15" fill="currentColor" height={size} width={size} {...props}>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M13.15 7.5c0-2.835-2.21-5.65-5.65-5.65-2.778 0-4.152 2.056-4.737 3.15H4.5a.5.5 0 010 1h-3a.5.5 0 01-.5-.5v-3a.5.5 0 011 0v1.813C2.705 3.071 4.334.85 7.5.85c4.063 0 6.65 3.335 6.65 6.65 0 3.315-2.587 6.65-6.65 6.65-1.944 0-3.562-.77-4.715-1.942a6.772 6.772 0 01-1.427-2.167.5.5 0 11.925-.38c.28.681.692 1.314 1.216 1.846.972.99 2.336 1.643 4.001 1.643 3.44 0 5.65-2.815 5.65-5.65zM7.5 4a.5.5 0 01.5.5v2.793l1.854 1.853a.5.5 0 01-.708.708l-2-2A.5.5 0 017 7.5v-3a.5.5 0 01.5-.5z"
      clipRule="evenodd"
    />
  </svg>
);

export const PlotLogo: React.FC<SVGProps<SVGSVGElement> & { size?: string }> = ({
  size = '1em', // default size is 1em, it can be overridden
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" height={size} width={size} {...props}>
    <path d="M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 7c0 2.8-2.2 5-5 5s-5-2.2-5-5 2.2-5 5-5 5 2.2 5 5M4 4h4v10H4V4m0 16v-4h4v4H4m16 0H10v-4h10v4z" />
  </svg>
);

export const Logo: React.FC<SVGProps<SVGSVGElement> & { size?: string }> = ({
  size = '1em', // default size is 1em, it can be overridden
  ...props
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" height={size} width={size} {...props}>
    <path d="M5.564.332v2.82L0 8.736l1.305 1.284 4.26-4.26v2.568L0 13.912l1.305 1.283 4.26-4.26v12.733h1.831V10.932l4.284 4.263 1.304-1.283-5.588-5.588V5.756l3.989 3.969 5.195 5.214v8.729h1.832v-8.725L24 9.355l-1.305-1.283-4.283 4.264V9.768L24 4.18l-1.305-1.284-4.283 4.264V.332H16.58v6.824l-4.26-4.26-1.304 1.284 5.564 5.584v2.568l-3.596-3.596-5.588-5.588V.332H5.564z" />
  </svg>
);

export const UserIconChecked: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg viewBox="0 0 640 512" fill="currentColor" height="1.5em" width="1.5em" {...props}>
    <path d="M352 128c0 70.7-57.3 128-128 128S96 198.7 96 128 153.3 0 224 0s128 57.3 128 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4c98.5 0 178.3 79.8 178.3 178.3 0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM625 177L497 305c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L591 143c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z" />
  </svg>
);

export const UserIconXMarked: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg viewBox="0 0 640 512" fill="currentColor" height="1.5em" width="1.5em" {...props}>
    <path d="M352 128c0 70.7-57.3 128-128 128S96 198.7 96 128 153.3 0 224 0s128 57.3 128 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4c98.5 0 178.3 79.8 178.3 178.3 0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM471 143c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z" />
  </svg>
);

export const DownloadIcon: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg viewBox="0 0 512 512" fill="currentColor" height="2em" width="2em" {...props}>
    <path d="M376 160H272v153.37l52.69-52.68a16 16 0 0122.62 22.62l-80 80a16 16 0 01-22.62 0l-80-80a16 16 0 0122.62-22.62L240 313.37V160H136a56.06 56.06 0 00-56 56v208a56.06 56.06 0 0056 56h240a56.06 56.06 0 0056-56V216a56.06 56.06 0 00-56-56zM272 48a16 16 0 00-32 0v112h32z" />
  </svg>
);

export const DeleteIcon: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24" height="2em" width="2em" {...props}>
    <path d="M20 5H9l-7 7 7 7h11a2 2 0 002-2V7a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" />
  </svg>
);

export const EditIcon: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg viewBox="0 0 1024 1024" fill="currentColor" height="2em" width="2em" {...props}>
    <path d="M257.7 752c2 0 4-.2 6-.5L431.9 722c2-.4 3.9-1.3 5.3-2.8l423.9-423.9a9.96 9.96 0 000-14.1L694.9 114.9c-1.9-1.9-4.4-2.9-7.1-2.9s-5.2 1-7.1 2.9L256.8 538.8c-1.5 1.5-2.4 3.3-2.8 5.3l-29.5 168.2a33.5 33.5 0 009.4 29.8c6.6 6.4 14.9 9.9 23.8 9.9zm67.4-174.4L687.8 215l73.3 73.3-362.7 362.6-88.9 15.7 15.6-89zM880 836H144c-17.7 0-32 14.3-32 32v36c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-36c0-17.7-14.3-32-32-32z" />
  </svg>
);

export const FileUploadIcon: React.FC<IconSvgProps> = ({ size = 24, width, height, ...props }: IconSvgProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" height="2em" width="2em" {...props}>
    <path d="M13 5.41V17a1 1 0 01-2 0V5.41l-3.3 3.3a1 1 0 01-1.4-1.42l5-5a1 1 0 011.4 0l5 5a1 1 0 11-1.4 1.42L13 5.4zM3 17a1 1 0 012 0v3h14v-3a1 1 0 012 0v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3z" />
  </svg>
);

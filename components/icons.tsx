import * as React from "react";
import {IconSvgProps} from "@/types";

export const Logo: React.FC<IconSvgProps> = ({
                                               size = 36,
                                               width,
                                               height,
                                               ...props
                                             }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    height="1em"
    width="1em"
    {...props}
  >
    <path
      d="M5.564.332v2.82L0 8.736l1.305 1.284 4.26-4.26v2.568L0 13.912l1.305 1.283 4.26-4.26v12.733h1.831V10.932l4.284 4.263 1.304-1.283-5.588-5.588V5.756l3.989 3.969 5.195 5.214v8.729h1.832v-8.725L24 9.355l-1.305-1.283-4.283 4.264V9.768L24 4.18l-1.305-1.284-4.283 4.264V.332H16.58v6.824l-4.26-4.26-1.304 1.284 5.564 5.584v2.568l-3.596-3.596-5.588-5.588V.332H5.564z"/>
  </svg>
);

export const UserIconChecked: React.FC<IconSvgProps> = ({
                                                          size = 24,
                                                          width,
                                                          height,
                                                          ...props
                                                        }: IconSvgProps) => (
  <svg
    viewBox="0 0 640 512"
    fill="currentColor"
    height="1.5em"
    width="1.5em"
    {...props}
  >
    <path
      d="M352 128c0 70.7-57.3 128-128 128S96 198.7 96 128 153.3 0 224 0s128 57.3 128 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4c98.5 0 178.3 79.8 178.3 178.3 0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM625 177L497 305c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L591 143c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/>
  </svg>
);

export const UserIconXMarked: React.FC<IconSvgProps> = ({
                                                          size = 24,
                                                          width,
                                                          height,
                                                          ...props
                                                        }: IconSvgProps) => (
  <svg
    viewBox="0 0 640 512"
    fill="currentColor"
    height="1.5em"
    width="1.5em"
    {...props}
  >
    <path
      d="M352 128c0 70.7-57.3 128-128 128S96 198.7 96 128 153.3 0 224 0s128 57.3 128 128zM0 482.3C0 383.8 79.8 304 178.3 304h91.4c98.5 0 178.3 79.8 178.3 178.3 0 16.4-13.3 29.7-29.7 29.7H29.7C13.3 512 0 498.7 0 482.3zM471 143c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"/>
  </svg>
);

export const DownloadIcon: React.FC<IconSvgProps> = ({
                                                       size = 24,
                                                       width,
                                                       height,
                                                       ...props
                                                     }: IconSvgProps) => (
  <svg
    viewBox="0 0 512 512"
    fill="currentColor"
    height="1em"
    width="1em"
    {...props}
  >
    <path
      d="M376 160H272v153.37l52.69-52.68a16 16 0 0122.62 22.62l-80 80a16 16 0 01-22.62 0l-80-80a16 16 0 0122.62-22.62L240 313.37V160H136a56.06 56.06 0 00-56 56v208a56.06 56.06 0 0056 56h240a56.06 56.06 0 0056-56V216a56.06 56.06 0 00-56-56zM272 48a16 16 0 00-32 0v112h32z"/>
  </svg>
);

export const DeleteIcon: React.FC<IconSvgProps> = ({
                                                     size = 24,
                                                     width,
                                                     height,
                                                     ...props
                                                   }: IconSvgProps) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    height="1em"
    width="1em"
    {...props}
  >
    <path d="M20 5H9l-7 7 7 7h11a2 2 0 002-2V7a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6"/>
  </svg>
);

export const EditIcon: React.FC<IconSvgProps> = ({
                                                   size = 24,
                                                   width,
                                                   height,
                                                   ...props
                                                 }: IconSvgProps) => (
  <svg
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    viewBox="0 0 24 24"
    height="1em"
    width="1em"
    {...props}
  >
    <path d="M20 5H9l-7 7 7 7h11a2 2 0 002-2V7a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6"/>
  </svg>
);

export const FileUploadIcon: React.FC<IconSvgProps> = ({
                                                         size = 24,
                                                         width,
                                                         height,
                                                         ...props
                                                       }: IconSvgProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    height="1em"
    width="1em"
    {...props}
  >
    <path
      d="M13 5.41V17a1 1 0 01-2 0V5.41l-3.3 3.3a1 1 0 01-1.4-1.42l5-5a1 1 0 011.4 0l5 5a1 1 0 11-1.4 1.42L13 5.4zM3 17a1 1 0 012 0v3h14v-3a1 1 0 012 0v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3z"/>
  </svg>
);
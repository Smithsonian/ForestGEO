import {  Listbox,   ListboxItem} from "@nextui-org/react";
import Typography from '@mui/joy/Typography';
import React from "react";

/**
 * These are the only FileWithPath attributes we use.
 * // import { FileWithPath } from 'react-dropzone';
 */
interface FileSize {
  path?: string;
  size: number;
  /** Can contain other fields, which we don't care about. */
  [otherFields: string]: any;
}
export interface FileListProps {
  acceptedFiles: FileSize[];
}

/**
 * A simple list of files with their sizes.
 */
export default function FileList({ acceptedFiles }: FileListProps) {
  return acceptedFiles.length > 0 ? (
    <>
      <Listbox>
        {acceptedFiles.map((file: FileSize) => (
          <ListboxItem
            key={file.path as string}
            textValue={`${file.path} - ${file.size} bytes`}>
          </ListboxItem>
        ))}
      </Listbox>
    </>
  ) : (
    <>
      <Typography level="h2">No files added</Typography>
    </>
  );
}
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

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
    <List>
      {acceptedFiles.map((file: FileSize) => (
        <ListItem>
          <ListItemText
            key={file.path}
            primary={`${file.path} - ${file.size} bytes`}
          />
        </ListItem>
      ))}
    </List>
  ) : (
    <Typography variant="h2">No files added</Typography>
  );
}

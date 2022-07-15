import { FileWithPath } from 'react-dropzone';

interface FileListProps {
  acceptedFiles: FileWithPath[];
}

export default function FileList({ acceptedFiles }: FileListProps) {
  const files = acceptedFiles.map((file: FileWithPath) => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ));

  return (
    <div>
      <aside>
        <ul>{files}</ul>
      </aside>
    </div>
  );
}

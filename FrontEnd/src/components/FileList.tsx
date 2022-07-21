import { FileWithPath } from 'react-dropzone';

interface FileListProps {
  acceptedFiles: FileWithPath[];
}

export default function FileList({ acceptedFiles }: FileListProps) {
  const newFiles = acceptedFiles.map((file: FileWithPath) => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ));

  return (
    <div>
      <aside>
        <ul>{newFiles}</ul>
      </aside>
    </div>
  );
}

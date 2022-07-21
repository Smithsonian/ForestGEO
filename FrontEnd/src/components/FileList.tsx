import { FileWithPath } from 'react-dropzone';

interface FileListProps {
  acceptedFilesList: FileWithPath[];
}

export default function FileList({ acceptedFilesList }: FileListProps) {
  const newFiles = acceptedFilesList.map((file: FileWithPath) => (
    <li key={file.path}>
      {file.path} - {file.size} bytes
    </li>
  ));

  return newFiles.length > 0 ? (
    <div>
      <aside>
        <ul>{newFiles}</ul>
      </aside>
    </div>
  ) : (
    <div>
      <aside>
        <h2>No files added</h2>
      </aside>
    </div>
  );
}

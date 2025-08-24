'use client';
import {
  Box,
  Button as JoyButton,
  Card,
  CardContent,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Modal,
  ModalDialog,
  Sheet,
  Stack,
  Typography
} from '@mui/joy';
import { UploadParseFilesProps } from '@/config/macros/uploadsystemmacros';
import { Button } from '@mui/material';
// Using Box layout instead of Grid for better compatibility
import { DropzoneCompact } from '@/components/uploadsystemhelpers/dropzonecompact';
import { FileListEnhanced } from '@/components/uploadsystemhelpers/filelistenhanced';
import React, { useCallback, useMemo, useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import { RequiredTableHeadersByFormType } from '@/config/macros/formdetails';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm,
    acceptedFiles,
    dataViewActive,
    setDataViewActive,
    handleInitialSubmit,
    handleAddFile,
    handleReplaceFile,
    handleRemoveFile,
    selectedDelimiters,
    setSelectedDelimiters
  } = props;

  const [fileToReplace, setFileToReplace] = useState<FileWithPath | null>(null);
  const [showHeaderHelp, setShowHeaderHelp] = useState<boolean>(false);

  const handleFileChange = async (newFiles: FileWithPath[]) => {
    for (const file of newFiles) {
      const existingFile = acceptedFiles.find(f => f.name === file.name);
      if (existingFile) {
        setFileToReplace(file);
      } else {
        handleAddFile(file);
      }
    }
  };

  const handleDelimiterChange = useCallback((fileName: string, delimiter: string) => {
    setSelectedDelimiters(prev => ({
      ...prev,
      [fileName]: delimiter
    }));
  }, []);

  const expectedHeaders = useMemo(() => {
    if (!uploadForm) return undefined;
    return RequiredTableHeadersByFormType[uploadForm]?.map(header => header.label);
  }, [uploadForm]);

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}>
      {/* Header Section - Compact */}
      <Sheet sx={{ p: 3, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography level="title-lg">File Upload</Typography>
              <Chip size="md" variant="solid" color="success">
                {uploadForm}
              </Chip>
            </Stack>

            <JoyButton variant="plain" size="sm" startDecorator={<InfoIcon />} onClick={() => setShowHeaderHelp(!showHeaderHelp)}>
              {showHeaderHelp ? 'Hide' : 'Show'} Header Guide
            </JoyButton>
          </Stack>

          {showHeaderHelp && (
            <Card variant="soft" color="primary" sx={{ mt: 2 }}>
              <CardContent>
                <Typography level="body-sm" sx={{ mb: 1 }}>
                  Required headers (order doesn't matter):
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {expectedHeaders?.map((header, index) => (
                    <Chip key={index} size="sm" variant="outlined">
                      {header}
                    </Chip>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Sheet>

      {/* Main Content Area */}
      <Box sx={{ flex: 1, overflow: 'hidden', p: 3 }}>
        <Box
          sx={{
            display: 'flex',
            gap: 3,
            height: '100%',
            flexDirection: { xs: 'column', md: 'row' }
          }}
        >
          {/* Left Side - File Upload */}
          <Box
            sx={{
              flex: { xs: '1', md: '0 0 40%' },
              minWidth: { xs: 'auto', md: '300px' }
            }}
          >
            <Stack spacing={3} sx={{ height: '100%' }}>
              <DropzoneCompact onChange={handleFileChange} hasFiles={acceptedFiles.length > 0} />
              {acceptedFiles.length > 0 && (
                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    disabled={acceptedFiles.length === 0}
                    onClick={handleInitialSubmit}
                    startIcon={<CheckCircleIcon />}
                    sx={{ flex: 1, maxWidth: 250 }}
                  >
                    Continue Upload ({acceptedFiles.length} {acceptedFiles.length === 1 ? 'file' : 'files'})
                  </Button>
                </Box>
              )}

              <Card variant="soft" sx={{ mt: 'auto' }}>
                <CardContent>
                  <Typography level="body-sm" sx={{ fontWeight: 'bold', mb: 1 }}>
                    💡 Upload Tips:
                  </Typography>
                  <Stack spacing={0.5}>
                    <Typography level="body-xs">• CSV, TSV, TXT, and Excel files supported</Typography>
                    <Typography level="body-xs">• Delimiter detection happens automatically</Typography>
                    <Typography level="body-xs">• Preview your data before uploading</Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          </Box>

          {/* Right Side - File List and Preview */}
          <Box
            sx={{
              flex: { xs: '1', md: '0 0 60%' },
              minHeight: { xs: '400px', md: 'auto' }
            }}
          >
            <Box sx={{ height: '100%', overflow: 'hidden' }}>
              <FileListEnhanced
                acceptedFiles={acceptedFiles}
                dataViewActive={dataViewActive}
                setDataViewActive={setDataViewActive}
                expectedHeaders={expectedHeaders}
                onDelimiterChange={handleDelimiterChange}
                selectedDelimiters={selectedDelimiters}
                onRemoveFile={handleRemoveFile}
              />
            </Box>
          </Box>
        </Box>
      </Box>

      {/* File Replacement Modal */}
      <Modal open={Boolean(fileToReplace)} onClose={() => setFileToReplace(null)}>
        <ModalDialog>
          <DialogTitle>Confirm File Replace</DialogTitle>
          <DialogContent>A file with the same name already exists. Do you want to replace it?</DialogContent>
          <DialogActions>
            <Button onClick={() => setFileToReplace(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (fileToReplace) {
                  const index = acceptedFiles.findIndex(f => f.name === fileToReplace.name);
                  handleReplaceFile(index, fileToReplace);
                }
                setFileToReplace(null);
              }}
            >
              Replace
            </Button>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

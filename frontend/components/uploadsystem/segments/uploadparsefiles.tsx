'use client';
import {
  Alert,
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
// Using Box layout instead of Grid for better compatibility
import { DropzoneCompact } from '@/components/uploadsystemhelpers/dropzonecompact';
import { FileListEnhanced } from '@/components/uploadsystemhelpers/filelistenhanced';
import React, { useCallback, useMemo, useState } from 'react';
import { FileWithPath } from 'react-dropzone';
import { FormType, RequiredTableHeadersByFormType, TableHeadersByFormType } from '@/config/macros/formdetails';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { UploadMode } from '@/config/uploadmodes';

export interface FileValidationStatus {
  fileName: string;
  isValid: boolean;
  issues: string[];
}

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm,
    uploadMode,
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
  const [fileValidationStatuses, setFileValidationStatuses] = useState<Record<string, FileValidationStatus>>({});

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

  const handleDelimiterChange = useCallback(
    (fileName: string, delimiter: string) => {
      setSelectedDelimiters(prev => ({
        ...prev,
        [fileName]: delimiter
      }));
    },
    [setSelectedDelimiters]
  );

  const handleValidationStatusChange = useCallback((fileName: string, isValid: boolean, issues: string[]) => {
    setFileValidationStatuses(prev => ({
      ...prev,
      [fileName]: { fileName, isValid, issues }
    }));
  }, []);

  // Check if all files have been validated and are valid
  const allFilesValid = useMemo(() => {
    if (acceptedFiles.length === 0) return false;
    // ArcGIS .xlsx uploads bypass CSV header validation; the workbook is validated at pre-flight.
    if (uploadForm === FormType.arcgis_xlsx) return true;
    // All files must have validation status and all must be valid
    return acceptedFiles.every(file => {
      const status = fileValidationStatuses[file.name];
      return status && status.isValid;
    });
  }, [acceptedFiles, fileValidationStatuses, uploadForm]);

  // Get all validation issues across all files
  const allValidationIssues = useMemo(() => {
    const issues: { fileName: string; issues: string[] }[] = [];
    acceptedFiles.forEach(file => {
      const status = fileValidationStatuses[file.name];
      if (status && !status.isValid && status.issues.length > 0) {
        issues.push({ fileName: file.name, issues: status.issues });
      }
    });
    return issues;
  }, [acceptedFiles, fileValidationStatuses]);

  // Check if any file is still being analyzed (no validation status yet)
  const isAnalyzing = useMemo(() => {
    return acceptedFiles.some(file => !fileValidationStatuses[file.name]);
  }, [acceptedFiles, fileValidationStatuses]);

  const headerGuideHeaders = useMemo(() => {
    if (!uploadForm) return undefined;
    if (uploadForm === FormType.arcgis_xlsx) return undefined;
    if (uploadForm === 'measurements' && uploadMode === UploadMode.REVISIONS) {
      return TableHeadersByFormType.measurements.filter(header => header.label !== 'errors').map(header => header.label);
    }
    return RequiredTableHeadersByFormType[uploadForm]?.map(header => header.label);
  }, [uploadForm, uploadMode]);

  const validationHeaders = useMemo(() => {
    if (!uploadForm) return undefined;
    if (uploadForm === FormType.arcgis_xlsx) return undefined;
    if (uploadForm === 'measurements' && uploadMode === UploadMode.REVISIONS) {
      return undefined;
    }
    return RequiredTableHeadersByFormType[uploadForm]?.map(header => header.label);
  }, [uploadForm, uploadMode]);

  const headerGuideLabel =
    uploadForm === 'measurements' && uploadMode === UploadMode.REVISIONS
      ? 'Allowed canonical headers for revision uploads (edited app exports with aliases like StemGUID, MeasuredDBH, and QuadratName are also accepted):'
      : "Required headers (order doesn't matter):";

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
                  {headerGuideLabel}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {headerGuideHeaders?.map((header, index) => (
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
                <Stack spacing={2}>
                  {/* Validation Error Alert */}
                  {allValidationIssues.length > 0 && (
                    <Alert color="danger" variant="soft" startDecorator={<ErrorOutlineIcon />} sx={{ textAlign: 'left' }}>
                      <Box>
                        <Typography level="title-sm" color="danger">
                          File Validation Issues
                        </Typography>
                        {allValidationIssues.map(({ fileName, issues }) => (
                          <Box key={fileName} sx={{ mt: 1 }}>
                            <Typography level="body-sm" sx={{ fontWeight: 'bold' }}>
                              {fileName}:
                            </Typography>
                            {issues.map((issue, idx) => (
                              <Typography key={idx} level="body-xs" sx={{ ml: 1 }}>
                                • {issue}
                              </Typography>
                            ))}
                          </Box>
                        ))}
                      </Box>
                    </Alert>
                  )}

                  <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                    <JoyButton
                      variant="solid"
                      color={allFilesValid ? 'primary' : 'neutral'}
                      size="lg"
                      disabled={acceptedFiles.length === 0 || !allFilesValid || isAnalyzing}
                      onClick={handleInitialSubmit}
                      startDecorator={allFilesValid ? <CheckCircleIcon /> : <ErrorOutlineIcon />}
                      sx={{ flex: 1, maxWidth: 300 }}
                    >
                      {isAnalyzing
                        ? 'Analyzing files...'
                        : allFilesValid
                          ? `Continue Upload (${acceptedFiles.length} ${acceptedFiles.length === 1 ? 'file' : 'files'})`
                          : 'Fix validation errors to continue'}
                    </JoyButton>
                  </Box>
                </Stack>
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
                expectedHeaders={headerGuideHeaders}
                validationHeaders={validationHeaders}
                onDelimiterChange={handleDelimiterChange}
                selectedDelimiters={selectedDelimiters}
                onRemoveFile={handleRemoveFile}
                onValidationStatusChange={handleValidationStatusChange}
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
            <JoyButton variant="plain" color="neutral" onClick={() => setFileToReplace(null)}>
              Cancel
            </JoyButton>
            <JoyButton
              variant="solid"
              color="primary"
              onClick={async () => {
                if (fileToReplace) {
                  const index = acceptedFiles.findIndex(f => f.name === fileToReplace.name);
                  handleReplaceFile(index, fileToReplace);
                }
                setFileToReplace(null);
              }}
            >
              Replace
            </JoyButton>
          </DialogActions>
        </ModalDialog>
      </Modal>
    </Box>
  );
}

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
import { RequiredTableHeadersByFormType, SourceFormat, TableHeadersByFormType } from '@/config/macros/formdetails';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import TuneIcon from '@mui/icons-material/Tune';
import { UploadMode } from '@/config/uploadmodes';
import ColumnMappingDialog from './columnmappingdialog';
import { mappingApplies, seedMapping, validateMapping } from '@/lib/column-mapping/mapping';
import { ColumnMapping, CsvSourceMetadata } from '@/lib/column-mapping/types';
import { DelimiterIssue, DelimiterIssueCode } from '@/components/uploadsystemhelpers/delimiterdetection';

export interface FileValidationStatus {
  fileName: string;
  isValid: boolean;
  issues: DelimiterIssue[];
  detectedHeaders: string[];
}

// Header-coverage failures are rescued by a valid column mapping (the whole point of mapping
// is to satisfy required fields from differently-named columns); structural issues are not.
const HEADER_COVERAGE_ISSUE_CODES = new Set([DelimiterIssueCode.MISSING_REQUIRED_COLUMNS, DelimiterIssueCode.TOO_FEW_COLUMNS]);

function isHeaderCoverageIssue(issue: DelimiterIssue): boolean {
  return HEADER_COVERAGE_ISSUE_CODES.has(issue.code);
}

export default function UploadParseFiles(props: Readonly<UploadParseFilesProps>) {
  const {
    uploadForm,
    uploadMode,
    sourceFormat,
    acceptedFiles,
    dataViewActive,
    setDataViewActive,
    handleInitialSubmit,
    handleAddFile,
    handleReplaceFile,
    handleRemoveFile,
    selectedDelimiters,
    setSelectedDelimiters,
    columnMappings,
    setColumnMappingForFile
  } = props;

  const [fileToReplace, setFileToReplace] = useState<FileWithPath | null>(null);
  const [showHeaderHelp, setShowHeaderHelp] = useState<boolean>(false);
  const [fileValidationStatuses, setFileValidationStatuses] = useState<Record<string, FileValidationStatus>>({});
  const [mappingOpen, setMappingOpen] = useState<boolean>(false);

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

  const handleValidationStatusChange = useCallback((fileName: string, isValid: boolean, issues: DelimiterIssue[], detectedHeaders: string[]) => {
    setFileValidationStatuses(prev => ({
      ...prev,
      [fileName]: { fileName, isValid, issues, detectedHeaders }
    }));
  }, []);

  // Column mapping applies to the CSV measurements flow only; ArcGIS workbooks map at pre-flight
  // and revision uploads validate against app-export headers instead.
  const mappingEnabled = uploadForm === 'measurements' && uploadMode !== UploadMode.REVISIONS && sourceFormat !== SourceFormat.arcgis_xlsx;

  const [mappingFile, setMappingFile] = useState<string | null>(null);

  const metadataFor = useCallback(
    (fileName: string): CsvSourceMetadata | null => {
      if (!mappingEnabled) return null;
      const status = fileValidationStatuses[fileName];
      return status && status.detectedHeaders.length > 0 ? { format: SourceFormat.csv, headers: status.detectedHeaders } : null;
    },
    [mappingEnabled, fileValidationStatuses]
  );

  const effectiveMappingFor = useCallback(
    (fileName: string): ColumnMapping | null => {
      const meta = metadataFor(fileName);
      if (!meta) return null;
      const stored = columnMappings?.[fileName];
      if (stored && mappingApplies(stored, meta.headers)) return stored;
      return seedMapping(meta);
    },
    [metadataFor, columnMappings]
  );

  // The mapping must resolve against every selected file's headers, not just the seeding file's.
  // Compute each file's validity ONCE per render: seedMapping + validateMapping are otherwise re-run
  // for every file by each consumer (mappingValid, fileEffectivelyValid, allValidationIssues, JSX).
  const perFileMappingValid = useMemo(() => {
    const out = new Map<string, boolean>();
    if (mappingEnabled) {
      for (const file of acceptedFiles) {
        const meta = metadataFor(file.name);
        const effective = meta ? effectiveMappingFor(file.name) : null;
        out.set(file.name, Boolean(meta && effective && validateMapping(effective, meta).valid));
      }
    }
    return out;
  }, [acceptedFiles, mappingEnabled, metadataFor, effectiveMappingFor]);

  const mappingValidForFile = useCallback((fileName: string): boolean => perFileMappingValid.get(fileName) ?? false, [perFileMappingValid]);

  const mappingValid = useMemo(
    () => acceptedFiles.length > 0 && acceptedFiles.every(file => mappingValidForFile(file.name)),
    [acceptedFiles, mappingValidForFile]
  );

  const arcgisValidationIssues = useMemo(() => {
    if (sourceFormat !== SourceFormat.arcgis_xlsx) return [];
    const issues: { fileName: string; issues: string[] }[] = [];
    if (acceptedFiles.length !== 1) {
      issues.push({
        fileName: 'ArcGIS workbook',
        issues: [`ArcGIS import accepts exactly one .xlsx workbook. ${acceptedFiles.length} files are selected.`]
      });
    }
    acceptedFiles.forEach(file => {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        issues.push({ fileName: file.name, issues: ['ArcGIS import requires a .xlsx workbook.'] });
      }
    });
    return issues;
  }, [acceptedFiles, sourceFormat]);

  // A file passes when its own header validation succeeded, or when a confirmed column mapping
  // covers its header-coverage gaps (structural issues like inconsistent column counts still block).
  const fileEffectivelyValid = useCallback(
    (fileName: string): boolean => {
      const status = fileValidationStatuses[fileName];
      if (!status) return false;
      if (status.isValid) return true;
      return mappingValidForFile(fileName) && status.issues.every(isHeaderCoverageIssue);
    },
    [fileValidationStatuses, mappingValidForFile]
  );

  // Check if all files have been validated and are valid
  const allFilesValid = useMemo(() => {
    if (acceptedFiles.length === 0) return false;
    // ArcGIS .xlsx uploads bypass CSV header validation; the workbook contents are validated at pre-flight.
    if (sourceFormat === SourceFormat.arcgis_xlsx) return arcgisValidationIssues.length === 0;
    return acceptedFiles.every(file => fileEffectivelyValid(file.name));
  }, [acceptedFiles, arcgisValidationIssues.length, fileEffectivelyValid, sourceFormat]);

  // Get all validation issues across all files
  const allValidationIssues = useMemo(() => {
    const issues: { fileName: string; issues: string[] }[] = [];
    acceptedFiles.forEach(file => {
      const status = fileValidationStatuses[file.name];
      if (status && !fileEffectivelyValid(file.name) && status.issues.length > 0) {
        // When a confirmed mapping covers the header-coverage gaps, hide those resolved messages so
        // only the structural blockers that still keep the file from validating are surfaced.
        const surfaced = mappingValidForFile(file.name) ? status.issues.filter(issue => !isHeaderCoverageIssue(issue)) : status.issues;
        if (surfaced.length > 0) {
          issues.push({ fileName: file.name, issues: surfaced.map(i => i.message) });
        }
      }
    });
    return sourceFormat === SourceFormat.arcgis_xlsx ? [...arcgisValidationIssues, ...issues] : issues;
  }, [acceptedFiles, arcgisValidationIssues, fileEffectivelyValid, fileValidationStatuses, mappingValidForFile, sourceFormat]);

  // Check if any file is still being analyzed (no validation status yet)
  const isAnalyzing = useMemo(() => {
    if (sourceFormat === SourceFormat.arcgis_xlsx) return false;
    return acceptedFiles.some(file => !fileValidationStatuses[file.name]);
  }, [acceptedFiles, fileValidationStatuses, sourceFormat]);

  const headerGuideHeaders = useMemo(() => {
    if (!uploadForm) return undefined;
    if (sourceFormat === SourceFormat.arcgis_xlsx) return undefined;
    if (uploadForm === 'measurements' && uploadMode === UploadMode.REVISIONS) {
      return TableHeadersByFormType.measurements.filter(header => header.label !== 'errors').map(header => header.label);
    }
    return RequiredTableHeadersByFormType[uploadForm]?.map(header => header.label);
  }, [uploadForm, uploadMode, sourceFormat]);

  const validationHeaders = useMemo(() => {
    if (!uploadForm) return undefined;
    if (sourceFormat === SourceFormat.arcgis_xlsx) return undefined;
    if (uploadForm === 'measurements' && uploadMode === UploadMode.REVISIONS) {
      return undefined;
    }
    return RequiredTableHeadersByFormType[uploadForm]?.map(header => header.label);
  }, [uploadForm, uploadMode, sourceFormat]);

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
              <DropzoneCompact onChange={handleFileChange} hasFiles={acceptedFiles.length > 0} sourceFormat={sourceFormat} />
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

                  <Box
                    sx={{
                      display: 'flex',
                      gap: 2,
                      justifyContent: 'center',
                      flexWrap: 'wrap',
                      position: 'sticky',
                      bottom: 0,
                      zIndex: 2,
                      py: 1,
                      bgcolor: 'background.surface',
                      borderTop: '1px solid',
                      borderColor: 'divider'
                    }}
                  >
                    {mappingEnabled &&
                      (() => {
                        const firstFileNeedingMapping =
                          acceptedFiles.find(f => {
                            const status = fileValidationStatuses[f.name];
                            return status && !status.isValid && !mappingValidForFile(f.name);
                          })?.name ??
                          acceptedFiles[0]?.name ??
                          null;
                        return (
                          <JoyButton
                            data-testid="open-column-mapping"
                            variant="outlined"
                            color={mappingValid ? 'neutral' : 'primary'}
                            size="lg"
                            startDecorator={<TuneIcon />}
                            disabled={!firstFileNeedingMapping || !metadataFor(firstFileNeedingMapping)}
                            onClick={() => {
                              setMappingFile(firstFileNeedingMapping);
                              setMappingOpen(true);
                            }}
                          >
                            {allFilesValid || mappingValid ? 'Review column mapping' : 'Map columns (required)'}
                          </JoyButton>
                        );
                      })()}
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
                          ? sourceFormat === SourceFormat.arcgis_xlsx
                            ? 'Continue to pre-flight'
                            : `Continue Upload (${acceptedFiles.length} ${acceptedFiles.length === 1 ? 'file' : 'files'})`
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
                    {sourceFormat === SourceFormat.arcgis_xlsx ? (
                      <>
                        <Typography level="body-xs">• Select one ArcGIS Field Maps .xlsx workbook</Typography>
                        <Typography level="body-xs">• Workbook columns are checked during pre-flight</Typography>
                        <Typography level="body-xs">• Diagnostics can be downloaded before import</Typography>
                      </>
                    ) : (
                      <>
                        <Typography level="body-xs">• CSV, TSV, and TXT files supported</Typography>
                        <Typography level="body-xs">• Delimiter detection happens automatically</Typography>
                        <Typography level="body-xs">• Preview your data before uploading</Typography>
                      </>
                    )}
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
                isArcgisWorkbook={sourceFormat === SourceFormat.arcgis_xlsx}
              />
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Column Mapping Dialog (CSV measurements flow) */}
      {mappingEnabled && mappingFile && metadataFor(mappingFile) && effectiveMappingFor(mappingFile) && (
        <ColumnMappingDialog
          open={mappingOpen}
          format={SourceFormat.csv}
          fileName={mappingFile}
          metadata={metadataFor(mappingFile)!}
          mapping={effectiveMappingFor(mappingFile)!}
          onApply={m => {
            setColumnMappingForFile?.(mappingFile, m);
            setMappingOpen(false);
          }}
          onClose={() => setMappingOpen(false)}
        />
      )}

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

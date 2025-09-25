'use client';
import React, { useState } from 'react';
import { FileListProps } from '@/config/macros/formdetails';
import { Box, Button, Card, CardContent, Chip, Divider, IconButton, Stack, Tab, TabList, TabPanel, Tabs, Typography } from '@mui/joy';
import FilePreviewCompact from './filepreviewcompact';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

interface FileListEnhancedProps extends FileListProps {
  expectedHeaders?: string[];
  onDelimiterChange: (fileName: string, delimiter: string) => void;
  selectedDelimiters: Record<string, string>;
  onRemoveFile: (fileIndex: number) => void;
}

export function FileListEnhanced(props: Readonly<FileListEnhancedProps>) {
  const { acceptedFiles, dataViewActive, setDataViewActive, expectedHeaders, onDelimiterChange, selectedDelimiters, onRemoveFile } = props;

  const [expandedPreview, setExpandedPreview] = useState<Record<number, boolean>>({});

  const handleTabChange = (event: React.SyntheticEvent | null, newValue: string | number | null) => {
    if (typeof newValue === 'number') {
      setDataViewActive(newValue + 1); // Convert to 1-based index
    }
  };

  const togglePreviewExpansion = (index: number) => {
    setExpandedPreview(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (acceptedFiles.length === 0) {
    return (
      <Card sx={{ display: 'flex', flex: 1, width: '100%', minHeight: 200 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography level="body-md" color="neutral">
            No files selected
          </Typography>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ display: 'flex', flex: 1, width: '100%', flexDirection: 'column' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ width: '100%' }}>
          <Typography level="title-md">Selected Files ({acceptedFiles.length})</Typography>
        </Stack>
      </Box>

      <CardContent sx={{ p: 0, flex: 1 }}>
        <Tabs value={dataViewActive - 1} onChange={handleTabChange} sx={{ width: '100%' }} orientation="vertical" size="sm">
          <TabList
            sx={{
              minWidth: '100%',
              '--TabList-gap': '2px',
              '--Tab-minHeight': '40px'
            }}
          >
            {acceptedFiles.map((file, index) => (
              <Tab
                key={index}
                value={index}
                sx={{
                  justifyContent: 'flex-start',
                  minHeight: '60px',
                  p: 1
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                  <InsertDriveFileIcon fontSize="small" />
                  <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      level="body-sm"
                      sx={{
                        fontWeight: 'bold',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {file.name}
                    </Typography>
                    <Typography level="body-xs" color="neutral">
                      {formatFileSize(file.size)}
                    </Typography>
                  </Stack>
                  <Button
                    component="span"
                    onClick={e => {
                      e.stopPropagation();
                      onRemoveFile(index);
                    }}
                    sx={{
                      ml: 'auto',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      bgcolor: 'danger.softBg',
                      color: 'danger.softColor',
                      '&:hover': {
                        bgcolor: 'danger.softHoverBg'
                      }
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </Button>
                </Stack>
              </Tab>
            ))}
          </TabList>

          {acceptedFiles.map((file, index) => (
            <TabPanel key={index} value={index} sx={{ p: 2 }}>
              <Stack spacing={2}>
                {/* File Details */}
                <Stack spacing={1}>
                  <Typography level="title-sm">File Details</Typography>
                  <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                    <Chip size="sm" variant="soft">
                      Size: {formatFileSize(file.size)}
                    </Chip>
                    <Chip size="sm" variant="soft">
                      Type: {file.type || 'Unknown'}
                    </Chip>
                    {file.lastModified && (
                      <Chip size="sm" variant="soft">
                        Modified: {new Date(file.lastModified).toLocaleDateString()}
                      </Chip>
                    )}
                  </Stack>
                </Stack>

                <Divider />

                {/* Format Detection */}
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography level="title-sm">Format Detection</Typography>
                    <Button
                      size="sm"
                      variant="plain"
                      startDecorator={expandedPreview[index] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      onClick={() => togglePreviewExpansion(index)}
                    >
                      {expandedPreview[index] ? 'Hide Preview' : 'Show Preview'}
                    </Button>
                  </Stack>

                  <FilePreviewCompact
                    file={file as File}
                    expectedHeaders={expectedHeaders}
                    onDelimiterChange={delimiter => onDelimiterChange(file.name, delimiter)}
                    initialDelimiter={selectedDelimiters[file.name]}
                    showPreview={expandedPreview[index]}
                  />
                </Stack>
              </Stack>
            </TabPanel>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

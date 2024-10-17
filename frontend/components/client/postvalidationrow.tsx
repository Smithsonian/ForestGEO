'use client';
import React, { useEffect, useState } from 'react';
import { Box, Collapse, TableCell, TableRow, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { PostValidationQueriesRDS } from '@/config/sqlrdsdefinitions/validations';
import { Checkbox, IconButton, Textarea } from '@mui/joy';
import { Done } from '@mui/icons-material';
import dynamic from 'next/dynamic';
import moment from 'moment/moment';

interface PostValidationRowProps {
  postValidation: PostValidationQueriesRDS;
  selectedResults: PostValidationQueriesRDS[];
  expanded: boolean;
  isDarkMode: boolean;
  expandedQuery: number | null;
  replacements: { schema: string | undefined; currentPlotID: number | undefined; currentCensusID: number | undefined };
  handleExpandClick: (queryID: number) => void;
  handleSelectResult: (postValidation: PostValidationQueriesRDS) => void;
}

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const PostValidationRow: React.FC<PostValidationRowProps> = ({
  expandedQuery,
  replacements,
  postValidation,
  expanded,
  isDarkMode,
  handleExpandClick,
  handleSelectResult,
  selectedResults
}) => {
  const [formattedResults, setFormattedResults] = useState(postValidation.lastRunResult);

  useEffect(() => {
    if (postValidation.lastRunResult) {
      try {
        const parsedJSON = JSON.parse(postValidation.lastRunResult);
        setFormattedResults(JSON.stringify(parsedJSON, null, 2));
      } catch (e: any) {
        console.error('Error parsing JSON:', e.message);
        throw new Error(e);
      }
    }
  }, [postValidation.lastRunResult]);
  return (
    <>
      <TableRow sx={{ '& > *': { borderBottom: 'unset' } }}>
        <TableCell>
          <IconButton aria-label="expand row" size="sm" onClick={() => handleExpandClick(postValidation.queryID!)}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </TableCell>
        <TableCell onClick={() => handleSelectResult(postValidation)} style={{ cursor: 'pointer', padding: '0', textAlign: 'center' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Checkbox
              uncheckedIcon={<Done />}
              label={''}
              checked={selectedResults.includes(postValidation)}
              slotProps={{
                root: ({ checked, focusVisible }) => ({
                  sx: !checked
                    ? {
                        '& svg': { opacity: focusVisible ? 1 : 0 },
                        '&:hover svg': {
                          opacity: 1
                        }
                      }
                    : undefined
                })
              }}
              onChange={e => e.stopPropagation()}
            />
          </Box>
        </TableCell>
        <TableCell>{postValidation.queryName}</TableCell>
        <TableCell>
          <Box
            sx={{
              maxWidth: expandedQuery === postValidation.queryID ? '60vw' : '100%',
              maxHeight: expandedQuery === postValidation.queryID ? '300px' : '60px',
              overflowX: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
              overflowY: expandedQuery === postValidation.queryID ? 'auto' : 'hidden',
              transition: 'all 0.3s ease',
              whiteSpace: expandedQuery === postValidation.queryID ? 'pre-wrap' : 'nowrap',
              position: 'relative'
            }}
          >
            {expandedQuery === postValidation.queryID ? (
              <Editor
                height={`${Math.min(300, 20 * (postValidation?.queryDefinition ?? '').split('\n').length)}px`}
                language="mysql"
                value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                  String(replacements[p1 as keyof typeof replacements] ?? '')
                )}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'off',
                  lineNumbers: 'off'
                }}
                theme={isDarkMode ? 'vs-dark' : 'light'}
              />
            ) : (
              <Textarea
                minRows={1}
                maxRows={3}
                value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                  String(replacements[p1 as keyof typeof replacements] ?? '')
                )}
                disabled
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                  resize: 'none'
                }}
              />
            )}
            <Box
              sx={{
                position: 'absolute',
                bottom: '4px',
                right: '4px'
              }}
            >
              <IconButton onClick={() => handleExpandClick(postValidation.queryID!)} size="sm">
                {expandedQuery === postValidation.queryID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
          </Box>
        </TableCell>
        <TableCell>{postValidation.description}</TableCell>
        <TableCell>{postValidation.lastRunAt && <>{moment(postValidation.lastRunAt).toString()}</>}</TableCell>
        <TableCell>{postValidation.lastRunResult && <>{postValidation.lastRunResult.substring(0, 100) + `...`}</>}</TableCell>
      </TableRow>

      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={6}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box margin={1}>
              <Typography variant="h6" gutterBottom component="div">
                Last Run Results
              </Typography>
              <Editor
                height={`${Math.min(300, 20 * formattedResults!.split('\n').length)}px`}
                defaultLanguage="json"
                value={formattedResults}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on'
                }}
                theme={isDarkMode ? 'vs-dark' : 'light'}
              />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

export default PostValidationRow;

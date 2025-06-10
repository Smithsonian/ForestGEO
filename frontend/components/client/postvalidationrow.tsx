// postvalidationrow.tsx
'use client';
import React from 'react';
import { Box, Collapse, TableCell, TableRow, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { PostValidationQueriesRDS } from '@/config/sqlrdsdefinitions/validations';
import { Checkbox, IconButton, Textarea, Tooltip } from '@mui/joy';
import { Done } from '@mui/icons-material';
import moment from 'moment/moment';
import { darken } from '@mui/system';
import CodeEditor from '@/components/client/codeeditor';

interface PostValidationRowProps {
  postValidation: PostValidationQueriesRDS;
  selectedResults: PostValidationQueriesRDS[];
  schemaDetails: { table_name: string; column_name: string }[];
  expanded: boolean;
  isDarkMode: boolean;
  expandedQuery: number | null;
  replacements: { schema: string | undefined; currentPlotID: number | undefined; currentCensusID: number | undefined };
  handleExpandClick: (queryID: number) => void;
  handleExpandResultsClick: (queryID: number) => void;
  handleSelectResult: (postValidation: PostValidationQueriesRDS) => void;
}

const PostValidationRow: React.FC<PostValidationRowProps> = ({
  expandedQuery,
  replacements,
  postValidation,
  expanded,
  isDarkMode,
  handleExpandClick,
  handleExpandResultsClick,
  handleSelectResult,
  selectedResults,
  schemaDetails
}) => {
  const formattedResults = JSON.stringify(JSON.parse(postValidation.lastRunResult ?? '{}'), null, 2);
  const successColor = !isDarkMode ? 'rgba(54, 163, 46, 0.3)' : darken('rgba(54,163,46,0.6)', 0.7);
  const failureColor = !isDarkMode ? 'rgba(255, 0, 0, 0.3)' : darken('rgba(255,0,0,0.6)', 0.7);

  return (
    <>
      <TableRow
        sx={{
          height: 'auto',
          borderBottom: 'unset',
          backgroundColor: postValidation.lastRunStatus ? (postValidation.lastRunStatus === 'success' ? successColor : failureColor) : undefined,
          margin: '0px', // No extra margin
          padding: '0px !important', // Force padding to 0
          borderBottomWidth: '0px', // Remove any bottom border
          borderBottomColor: 'transparent', // Ensure no visible border
          borderTopWidth: '0px',
          borderTopColor: 'transparent'
        }}
      >
        <TableCell
          sx={{
            padding: '0px !important',
            margin: '0px !important',
            height: 'auto'
          }}
        >
          <IconButton
            sx={{
              alignSelf: 'center',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            aria-label="expand row"
            size="sm"
            onClick={() => handleExpandResultsClick(postValidation.queryID!)}
          >
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
        <Tooltip
          title={`Last Run: ${postValidation.lastRunStatus}`}
          color={postValidation.lastRunStatus ? (postValidation.lastRunStatus === 'success' ? 'success' : 'danger') : 'neutral'}
          arrow
          placement="right"
          size="lg"
        >
          <TableCell>{postValidation.queryName}</TableCell>
        </Tooltip>
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
              <CodeEditor
                schemaDetails={schemaDetails}
                value={postValidation.queryDefinition!.replace(/\${(.*?)}/g, (_match: any, p1: string) =>
                  String(replacements[p1 as keyof typeof replacements] ?? '')
                )}
                setValue={undefined}
                height={`${Math.min(300, 20 * (postValidation?.queryDefinition ?? '').split('\n').length)}px`}
                isDarkMode={isDarkMode}
                readOnly={true}
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
        <TableCell
          sx={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {postValidation.lastRunResult || 'No results'}
        </TableCell>
      </TableRow>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <TableRow sx={{ height: 'auto' }}>
          <TableCell colSpan={7} sx={{ height: 'auto', border: 'none' }}>
            <Box
              sx={{
                margin: 1,
                flex: 1,
                width: '100%',
                ...(expanded ? {} : { maxHeight: '60px', overflow: 'hidden' }),
                transition: 'max-height 0.3s ease',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <Typography variant="h6" gutterBottom>
                Last Run Results
              </Typography>
              <CodeEditor
                value={formattedResults ?? ''}
                setValue={undefined}
                schemaDetails={schemaDetails}
                height={'auto'}
                isDarkMode={isDarkMode}
                readOnly={true}
              />
            </Box>
          </TableCell>
        </TableRow>
      </Collapse>
    </>
  );
};

export default PostValidationRow;

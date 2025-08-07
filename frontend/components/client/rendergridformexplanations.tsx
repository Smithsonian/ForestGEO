'use client';

import { DatagridType, getFormForDataGrid, getFormHeaderForGridHeader, HeadersByDatagridType, TableHeadersByFormType } from '@/config/macros/formdetails';
import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  FormHelperText,
  List,
  ListItem,
  Tooltip,
  Typography
} from '@mui/joy';
import React from 'react';
import WarningIcon from '@mui/icons-material/Warning';

export default function RenderGridFormExplanations({ datagridType }: { datagridType: DatagridType }) {
  const categoryRegex = /alive(?:-not measured)?|dead|missing|broken below|stem dead/g;
  const matches = HeadersByDatagridType[datagridType].find(obj => obj.label === 'Status')?.explanation?.match(categoryRegex);
  const cleanedString = HeadersByDatagridType[datagridType]
    .find(obj => obj.label === 'Status')
    ?.explanation?.replace(categoryRegex, '')
    .replace(/\s*,\s*/g, '')
    .trim();

  const mappedForm = getFormForDataGrid(datagridType);

  const formMatches = TableHeadersByFormType[mappedForm].find(obj => obj.label === 'status')?.explanation?.match(categoryRegex);
  const formCleanedString = TableHeadersByFormType[mappedForm]
    .find(obj => obj.label === 'status')
    ?.explanation?.replace(categoryRegex, '')
    .replace(/\s*,\s*/g, '')
    .trim();

  return (
    <Box role="region" aria-labelledby="grid-form-explanations-heading" sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <AccordionGroup>
        <Accordion aria-label="Grid and upload form headers explanation">
          <AccordionSummary id="grid-form-explanation-summary" aria-controls="grid-form-explanation-content">
            <Typography id="grid-form-explanations-heading" level="title-lg" component="h2" sx={{ textAlign: 'center', my: 2 }}>
              Understanding Grid and Upload Form Headers
            </Typography>
          </AccordionSummary>
          <AccordionDetails id="grid-form-explanation-content" aria-labelledby="grid-form-explanation-summary">
            <FormHelperText role="note" aria-live="polite" sx={{ mb: 1 }}>
              Remember that Form headers are <strong>bold</strong> if required for upload!
            </FormHelperText>

            <Box
              role="list"
              aria-label="Header mapping cards"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1rem',
                mb: 1,
                width: '100%',
                boxSizing: 'border-box'
              }}
            >
              {HeadersByDatagridType[datagridType].map((header, index) => (
                <Card key={index} role="group" aria-labelledby={`grid-header-label-${index}`} size="sm">
                  <CardContent>
                    <Chip role="presentation" aria-hidden="true" variant="soft" sx={{ mb: 1 }}>
                      Grid Header
                    </Chip>
                    <Typography
                      id={`grid-header-label-${index}`}
                      level="title-sm"
                      color="primary"
                      sx={{ fontWeight: header.category === 'required' ? 'bold' : 'normal' }}
                    >
                      {header.label}
                    </Typography>

                    {header.label === 'Status' ? (
                      <Box role="group" aria-labelledby={`grid-status-desc-${index}`} sx={{ mt: 1 }}>
                        <Typography id={`grid-status-desc-${index}`} level="body-sm">
                          {cleanedString}
                        </Typography>
                        <Box role="list" aria-label="Grid status categories" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {matches?.map((category, idx) => (
                            <Chip key={idx} role="listitem" aria-label={category} variant="soft">
                              {category}
                            </Chip>
                          ))}
                        </Box>
                      </Box>
                    ) : (
                      <Typography level="body-sm">{header.explanation}</Typography>
                    )}
                  </CardContent>

                  <Divider component="div" aria-orientation="horizontal" sx={{ my: 1 }}>
                    <Typography level="body-sm" fontWeight="bold" component="span">
                      maps to
                    </Typography>
                  </Divider>

                  <CardContent>
                    <Chip role="presentation" aria-hidden="true" variant="soft" sx={{ mb: 1 }}>
                      Form Header
                    </Chip>
                    <Typography
                      id={`form-header-label-${index}`}
                      level="title-sm"
                      color="primary"
                      sx={{
                        fontWeight: getFormHeaderForGridHeader(datagridType, header.label)?.category === 'required' ? 'bold' : 'normal'
                      }}
                    >
                      {getFormHeaderForGridHeader(datagridType, header.label)?.label}
                    </Typography>

                    {getFormHeaderForGridHeader(datagridType, header.label)?.label === 'status' ? (
                      <Box role="group" aria-labelledby={`form-status-desc-${index}`} sx={{ mt: 1 }}>
                        <Typography id={`form-status-desc-${index}`} level="body-sm">
                          {formCleanedString}
                        </Typography>
                        <Box role="list" aria-label="Form status categories" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {formMatches?.map((category, idx) => (
                            <Chip key={idx} role="listitem" aria-label={category} variant="soft">
                              {category}
                            </Chip>
                          ))}
                        </Box>
                      </Box>
                    ) : (
                      <Typography level="body-sm">{getFormHeaderForGridHeader(datagridType, header.label)?.explanation}</Typography>
                    )}

                    {/* Date format alert */}
                    {getFormHeaderForGridHeader(datagridType, header.label)?.label.includes('date') && (
                      <Alert role="alert" startDecorator={<WarningIcon fontSize="large" aria-hidden="true" />} variant="soft" color="danger" sx={{ mt: 2 }}>
                        <Typography component="div" level="body-sm">
                          Please note: For date fields, accepted formats are
                          <List marker="decimal" aria-label="Date format list">
                            <ListItem>
                              <Tooltip describeChild title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                <Typography color="primary">YYYY-MM-DD</Typography>
                              </Tooltip>
                            </ListItem>
                            <ListItem>
                              <Tooltip describeChild title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                <Typography color="primary">DD-MM-YYYY</Typography>
                              </Tooltip>
                            </ListItem>
                          </List>
                          <Typography level="body-sm" component="p" sx={{ mt: 1 }}>
                            Hover over formats to see additionally accepted separators.
                            <br />
                            Please ensure your dates follow one of these formats.
                          </Typography>
                        </Typography>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>
    </Box>
  );
}

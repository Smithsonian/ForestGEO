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
    <Box
      sx={{
        display: 'inherit', // Ensure layout is flex-based
        flexDirection: 'column',
        width: '100%'
      }}
    >
      <AccordionGroup>
        <Accordion>
          <AccordionSummary>
            <Typography level="title-lg" sx={{ alignSelf: 'center', justifyContent: 'center', alignContent: 'center', my: 2 }}>
              Understanding Grid and Upload Form Headers
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <FormHelperText sx={{ marginBottom: 1 }}>
              Remember that Form headers are <strong>bold</strong> if required for upload!
            </FormHelperText>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1rem',
                mb: 1,
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                alignItems: 'stretch'
              }}
            >
              {HeadersByDatagridType[datagridType].map((header, index) => (
                <Card
                  key={index}
                  size="sm"
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: 'md'
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'flex-start', p: 1 }}>
                    <Chip variant="soft">Grid Header</Chip>
                  </Box>
                  <Card
                    variant="outlined"
                    sx={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      mx: 1
                    }}
                  >
                    <CardContent sx={{ flex: 1, pt: 0 }}>
                      <Typography level="title-sm" color="primary" sx={{ fontWeight: header.category === 'required' ? 'bold' : 'normal' }}>
                        {header.label}
                      </Typography>
                      {header.label === 'Status' ? (
                        <Box display="flex" flex={1} flexDirection="column">
                          <Typography level="body-sm">{cleanedString}</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {matches?.map((category, index) => (
                              <Chip key={index} variant="soft">
                                {category}
                              </Chip>
                            ))}
                          </Box>
                        </Box>
                      ) : (
                        <>
                          <Typography level="body-sm">{header.explanation}</Typography>
                          {header.label.includes('date') && (
                            <Alert startDecorator={<WarningIcon fontSize="large" />} variant="soft" color="danger" sx={{ mb: 2 }}>
                              <Typography component="div">
                                Please note: For date fields, accepted formats are
                                <List marker="decimal">
                                  <ListItem>
                                    <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                      <Typography color="primary">YYYY-MM-DD</Typography>
                                    </Tooltip>
                                  </ListItem>
                                  <ListItem>
                                    <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                      <Typography color="primary">DD-MM-YYYY</Typography>
                                    </Tooltip>
                                  </ListItem>
                                </List>
                                Hover over formats to see additionally accepted separators.
                                <br />
                                Please ensure your dates follow one of these formats.
                              </Typography>
                            </Alert>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                  <Divider orientation={'horizontal'} sx={{ my: 0.5 }} component={'div'} role={'presentation'}>
                    <Typography level="body-sm" fontWeight={'bold'}>
                      maps to
                    </Typography>
                  </Divider>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-start', p: 1 }}>
                    <Chip variant="soft">Form Header</Chip>
                  </Box>
                  <Card
                    variant="outlined"
                    sx={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: 0,
                      mx: 1,
                      mb: 1
                    }}
                  >
                    <CardContent sx={{ flex: 1, pt: 0 }}>
                      <Typography
                        level="title-sm"
                        color={'primary'}
                        sx={{ fontWeight: getFormHeaderForGridHeader(datagridType, header.label)?.category === 'required' ? 'bold' : 'normal' }}
                      >
                        {getFormHeaderForGridHeader(datagridType, header.label)?.label}
                      </Typography>
                      {getFormHeaderForGridHeader(datagridType, header.label)?.label === 'status' ? (
                        <Box display="flex" flex={1} flexDirection="column">
                          <Typography level="body-sm">{formCleanedString}</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {formMatches?.map((category, index) => (
                              <Chip key={index} variant="soft">
                                {category}
                              </Chip>
                            ))}
                          </Box>
                        </Box>
                      ) : (
                        <>
                          <Typography level="body-sm">{getFormHeaderForGridHeader(datagridType, header.label)?.explanation}</Typography>
                          {getFormHeaderForGridHeader(datagridType, header.label)?.label.includes('date') && (
                            <Alert startDecorator={<WarningIcon fontSize="large" />} variant="soft" color="danger" sx={{ mb: 2 }}>
                              <Typography component="div">
                                Please note: For date fields, accepted formats are
                                <List marker="decimal">
                                  <ListItem>
                                    <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                      <Typography color="primary">YYYY-MM-DD</Typography>
                                    </Tooltip>
                                  </ListItem>
                                  <ListItem>
                                    <Tooltip size="lg" title="Accepted separators: '-' (dash), '.' (period) or '/' (forward-slash)">
                                      <Typography color="primary">DD-MM-YYYY</Typography>
                                    </Tooltip>
                                  </ListItem>
                                </List>
                                Hover over formats to see additionally accepted separators.
                                <br />
                                Please ensure your dates follow one of these formats.
                              </Typography>
                            </Alert>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Card>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>
    </Box>
  );
}

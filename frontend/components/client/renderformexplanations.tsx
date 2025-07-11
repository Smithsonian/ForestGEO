'use client';

import { FormType, TableHeadersByFormType } from '@/config/macros/formdetails';
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
  List,
  ListItem,
  Tooltip,
  Typography
} from '@mui/joy';
import React from 'react';
import WarningIcon from '@mui/icons-material/Warning';

export default function RenderFormExplanations(uploadForm: FormType) {
  const categoryRegex = /alive(?:-not measured)?|dead|missing|broken below|stem dead/g;
  const matches = TableHeadersByFormType[uploadForm].find(obj => obj.label === 'status')?.explanation?.match(categoryRegex);
  const cleanedString = TableHeadersByFormType[uploadForm]
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
              Understanding Form Headers
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '1rem',
                mb: 1,
                width: '100%', // Ensure the grid takes the full width
                boxSizing: 'border-box'
              }}
            >
              {TableHeadersByFormType[uploadForm].map((header, index) => (
                <Card key={index} size="sm" sx={{ flex: 1 }}>
                  <Typography level="title-sm" color={header.category === 'required' ? 'primary' : 'neutral'}>
                    {header.label}
                  </Typography>
                  <CardContent>
                    {header.label === 'status' ? (
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
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>
    </Box>
  );
}

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
        width: '100%',
        '@keyframes fadeSlideIn': {
          from: {
            opacity: 0,
            transform: 'translateY(-10px)'
          },
          to: {
            opacity: 1,
            transform: 'translateY(0)'
          }
        }
      }}
    >
      <AccordionGroup>
        <Accordion>
          <AccordionSummary
            sx={{
              bgcolor: 'primary.softBg',
              borderRadius: 'md',
              transition: 'all 0.3s ease',
              '&:hover': {
                boxShadow: theme => `0 4px 12px ${theme.palette.primary.softBg}`
              }
            }}
          >
            <Typography
              level="title-lg"
              sx={{
                alignSelf: 'center',
                justifyContent: 'center',
                alignContent: 'center',
                my: 2,
                fontWeight: 700,
                color: 'primary.solidBg'
              }}
            >
              📋 Understanding Form Headers
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
                <Card
                  key={index}
                  size="sm"
                  sx={{
                    flex: 1,
                    animation: `fadeSlideIn 0.${5 + index}s ease-out`,
                    background: theme =>
                      header.category === 'required'
                        ? `linear-gradient(135deg, ${theme.palette.primary.softBg} 0%, rgba(34, 197, 94, 0.05) 100%)`
                        : `linear-gradient(135deg, ${theme.palette.neutral.softBg} 0%, rgba(120, 113, 108, 0.05) 100%)`,
                    borderLeft: theme => `4px solid ${header.category === 'required' ? theme.palette.primary[400] : theme.palette.neutral[300]}`,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: theme =>
                        header.category === 'required' ? `0 8px 24px ${theme.palette.primary.softBg}` : `0 8px 24px ${theme.palette.neutral.softBg}`
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography
                      level="title-sm"
                      color={header.category === 'required' ? 'primary' : 'neutral'}
                      sx={{
                        fontWeight: header.category === 'required' ? 700 : 600,
                        flex: 1
                      }}
                    >
                      {header.label}
                    </Typography>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={header.category === 'required' ? 'primary' : 'neutral'}
                      sx={{
                        fontWeight: 600,
                        fontSize: '0.7rem',
                        px: 1,
                        animation: header.category === 'required' ? 'pulse 2s ease-in-out infinite' : 'none',
                        '@keyframes pulse': {
                          '0%, 100%': { opacity: 1 },
                          '50%': { opacity: 0.7 }
                        }
                      }}
                    >
                      {header.category?.toUpperCase()}
                    </Chip>
                  </Box>
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

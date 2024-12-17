'use client';

import { FormType, TableHeadersByFormType } from '@/config/macros/formdetails';
import { Alert, Box, Card, CardContent, Chip, List, ListItem, Stack, Tooltip, Typography } from '@mui/joy';
import React from 'react';
import WarningIcon from '@mui/icons-material/Warning';

export default function RenderFormExplanations(uploadForm: FormType) {
  const numBlocks = Math.floor(100 / TableHeadersByFormType[FormType.attributes].length);
  const categoryRegex = /alive(?:-not measured)?|dead|missing|broken below|stem dead/g;
  const matches = TableHeadersByFormType[uploadForm].find(obj => obj.label === 'status')?.explanation?.match(categoryRegex);
  const cleanedString = TableHeadersByFormType[uploadForm]
    .find(obj => obj.label === 'status')
    ?.explanation?.replace(categoryRegex, '')
    .replace(/\s*,\s*/g, '')
    .trim();

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
      <Typography level={'title-lg'} sx={{ alignSelf: 'center', justifyContent: 'center', alignContent: 'center', my: 2 }}>
        Understanding the Headers
      </Typography>
      <Stack direction={'row'} flexWrap={'wrap'} sx={{ mb: 5 }}>
        {TableHeadersByFormType[uploadForm].map((header, index) => (
          <Card key={index} size={'sm'} sx={{ flex: `1 1 calc(${numBlocks}% - 1rem)` }}>
            <Typography level={'title-sm'} color={'primary'} sx={{ fontWeight: header.category === 'required' ? 'bold' : 'normal' }}>
              {header.label}
            </Typography>
            <CardContent>
              {header.label === 'status' ? (
                <Box display={'flex'} flex={1} flexDirection={'column'}>
                  <Typography level={'body-sm'}>{cleanedString}</Typography>
                  <Stack direction={'row'} spacing={0.5}>
                    {matches?.map((category, index) => (
                      <Chip key={index} variant="soft">
                        {category}
                      </Chip>
                    ))}
                  </Stack>
                </Box>
              ) : (
                <>
                  <Typography level={'body-sm'}>{header.explanation}</Typography>
                  {header.label.includes('date') && (
                    <Alert startDecorator={<WarningIcon fontSize="large" />} variant="soft" color="danger" sx={{ mb: 2 }}>
                      <Typography component={'div'}>
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
      </Stack>
    </Box>
  );
}

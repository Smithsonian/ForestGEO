'use client';

import { Card, CardContent, Grid, Typography } from '@mui/joy';

export default function ValidationsHubPage() {
  return (
    <>
      <Grid container spacing={2}>
        <Grid xs={6}>
          <Card variant={'soft'} color={'primary'} invertedColors>
            <CardContent>
              <Typography level={'title-lg'} fontWeight={'bold'}>
                Measurements Pending Validation
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid xs={6}></Grid>
      </Grid>
    </>
  );
}

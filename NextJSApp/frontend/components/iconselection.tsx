import {Card, CardCover, Link} from '@mui/joy';
import {CardContent} from "@mui/joy";
import Typography from "@mui/joy/Typography";

import Image from 'next/image';
import NextLink from 'next/link';

export function TemplateCard(image: any, cardIcon: any, cardTitle: string, cardLink: string) {
  return (
    <>
      {/*<Card sx={{ minHeight: '280px', maxWidth: '350px'}}>*/}
      <Card>
        <CardCover>
          <Image
            src={image}
            alt=""
          />
        </CardCover>
        <CardCover
          sx={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.4), rgba(0,0,0,0) 200px), linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0) 300px)',
          }}
        />
        <CardContent sx={{ justifyContent: 'flex-end' }}>
          <Typography level="title-lg" textColor="#fff">
            <Link
              component={NextLink}
              overlay
              underline="none"
              href={cardLink}
              sx={{ color: 'text.tertiary' }}
            >
              {cardTitle}
            </Link>
          </Typography>
          <Typography
            startDecorator={cardIcon}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
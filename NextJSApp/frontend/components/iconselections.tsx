import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import { Card, CardCover } from '@mui/joy';
import {CardContent} from "@mui/joy";
import Typography from "@mui/joy/Typography";
import PersonnelBackground from '@/public/personneliconphoto.jpg';
import SpeciesBackground from '@/public/speciesiconphoto.jpg';
import AttributeBackground from '@/public/attributesiconphoto.jpg';
import CensusBackground from '@/public/censusiconphoto.jpg';
import QuadratBackground from '@/public/quadraticonphoto.jpg';
import Image from 'next/image';
export function PersonnelCard() {
  
  return (
    <>
      <Card sx={{ minHeight: '280px', width: 320 }}>
        <CardCover>
          <Image
            src={PersonnelBackground}
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
            Personnel
          </Typography>
          <Typography
            startDecorator={<ManageAccountsIcon />}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}

export function SpeciesCard() {
  return (
    <>
      <Card sx={{ minHeight: '280px', width: 320 }}>
        <CardCover>
          <Image
            src={SpeciesBackground}
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
            Species
          </Typography>
          <Typography
            startDecorator={<ManageAccountsIcon />}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}

export function AttributesCard() {
  return (
    <>
      <Card sx={{ minHeight: '280px', width: 320 }}>
        <CardCover>
          <Image
            src={AttributeBackground}
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
            Attributes
          </Typography>
          <Typography
            startDecorator={<ManageAccountsIcon />}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}

export function CensusCard() {
  return (
    <>
      <Card sx={{ minHeight: '280px', width: 320 }}>
        <CardCover>
          <Image
            src={CensusBackground}
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
            Census
          </Typography>
          <Typography
            startDecorator={<ManageAccountsIcon />}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}

export function QuadratCard() {
  return (
    <>
      <Card sx={{ minHeight: '280px', width: 320 }}>
        <CardCover>
          <Image
            src={QuadratBackground}
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
            Quadrat
          </Typography>
          <Typography
            startDecorator={<ManageAccountsIcon />}
            textColor="neutral.300"
          >
            View and Edit
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
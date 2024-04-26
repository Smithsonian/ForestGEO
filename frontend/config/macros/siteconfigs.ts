import DashboardIcon from '@mui/icons-material/Dashboard';
import DataObjectIcon from '@mui/icons-material/DataObject';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import CloudCircleIcon from '@mui/icons-material/CloudCircle';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import DescriptionIcon from '@mui/icons-material/Description';
import GridOnIcon from '@mui/icons-material/GridOn';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import WidgetsIcon from '@mui/icons-material/Widgets';
import BugReportIcon from '@mui/icons-material/BugReport';
import BugReportSharp from '@mui/icons-material/BugReport';
import LoupeIcon from '@mui/icons-material/Loupe';
import PestControlIcon from '@mui/icons-material/PestControl';

export type SiteConfigProps = {
  label: string;
  href: string;
  tip: string;
  icon: React.ElementType;
  expanded: {
    label: string;
    href: string;
    tip: string;
    icon: React.ElementType;
  }[];
};
export const siteConfig = {
  name: "ForestGEO",
  description: "Census data entry and storage",
};

export const siteConfigNav: SiteConfigProps[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    tip: 'Home Page',
    icon: DashboardIcon,
    expanded: [],
  },
  {
    label: "Measurements Hub",
    href: "/measurementshub",
    tip: 'View existing core measurement data for a given plot, census, and quadrat',
    icon: DataObjectIcon,
    expanded: [
      {
        label: "View Measurements",
        href: "/summary",
        tip: '',
        icon: VisibilityIcon
      },
      {
        label: "Stem and Tree Details",
        href: "/stemtreedetails",
        tip: '',
        icon: HistoryEduIcon
      },
      // {
      //   label: "Validation History",
      //   href: "/validationhistory",
      //   tip: '',
      //   icon: HistoryEduIcon
      // },
      {
        label: "Uploaded Files",
        href: "/uploadedfiles",
        tip: "uploaded file display",
        icon: CloudCircleIcon,
      },
    ],
  },
  {
    label: "Measurement Properties Hub",
    href: "/properties",
    tip: 'View Modifiable Properties',
    icon: SettingsSuggestIcon,
    expanded: [
      {
        label: 'Attributes',
        href: '/attributes',
        tip: '',
        icon: DescriptionIcon,
      },
      {
        label: 'Census',
        href: '/census',
        tip: '',
        icon: GridOnIcon,
      },
      {
        label: 'Personnel',
        href: '/personnel',
        tip: '',
        icon: AccountCircleIcon,
      },
      {
        label: 'Quadrats',
        href: '/quadrats',
        tip: '',
        icon: WidgetsIcon,
      },
      // {
      //   label: 'Subquadrats',
      //   href: '/subquadrats',
      //   tip: '',
      //   icon: LoupeIcon,
      // },
      {
        label: 'Species',
        href: '/species',
        tip: '',
        icon: BugReportIcon,
      },
      {
        label: 'Subspecies',
        href: '/subspecies',
        tip: '',
        icon: PestControlIcon,
      }
    ]
  },
  // {
  //   label: "Manual Input Forms (CTFSWeb)",
  //   href: "/forms",
  //   tip: 'forms from ctfsweb',
  //   icon: SettingsSuggestIcon,
  //   expanded: [
  //     {
  //       label: 'Census Form',
  //       href: '/census',
  //       tip: '',
  //       icon: DescriptionIcon,
  //     },
  //   ]
  // },
];


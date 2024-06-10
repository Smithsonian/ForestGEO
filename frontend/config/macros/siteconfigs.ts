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
import SchemaIcon from '@mui/icons-material/Schema';
import PlaceIcon from '@mui/icons-material/Place';
import FilterIcon from '@mui/icons-material/Filter';
import React from "react";
import {UnifiedValidityFlags} from '../macros';

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

type DataValidityKey = keyof UnifiedValidityFlags;

// Define a mapping type that restricts keys to strings and values to keys of DataValidity
type ValidityMapping = {
  [key: string]: DataValidityKey;
};

export const validityMapping: ValidityMapping = {
  '/attributes': 'attributes',
  '/personnel': 'personnel',
  '/alltaxonomies': 'species',
  '/quadrats': 'quadrats',
  '/subquadrats': 'subquadrats',
  '/quadratpersonnel': 'quadratpersonnel'
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
    label: "Supporting Data Views",
    href: "/fixeddatainput",
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
      {
        label: 'Subquadrats',
        href: '/subquadrats',
        tip: '',
        icon: WidgetsIcon,
      },
      {
        label: 'QuadratPersonnel',
        href: '/quadratpersonnel',
        tip: '',
        icon: WidgetsIcon,
      },
      // {
      //   label: 'Species',
      //   href: '/species',
      //   tip: '',
      //   icon: BugReportIcon,
      // },
      // {
      //   label: "View Stem Taxonomies",
      //   href: "/stemtaxonomies",
      //   tip: '',
      //   icon: FilterIcon
      // },
      // {
      //   label: "View Stem Dimensions",
      //   href: "/stemdimensions",
      //   tip: '',
      //   icon: PlaceIcon
      // },
      {
        label: "View All Taxonomies",
        href: "/alltaxonomies",
        tip: '',
        icon: SchemaIcon
      },
      // {
      //   label: 'Measurements Form',
      //   href: '/measurementsform',
      //   tip: '',
      //   icon: DescriptionIcon,
      // },
    ]
  },
];


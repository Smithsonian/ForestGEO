import DashboardIcon from '@mui/icons-material/Dashboard';
import DataObjectIcon from '@mui/icons-material/DataObject';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloudCircleIcon from '@mui/icons-material/CloudCircle';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import DescriptionIcon from '@mui/icons-material/Description';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import WidgetsIcon from '@mui/icons-material/Widgets';
import SchemaIcon from '@mui/icons-material/Schema';
import FilterIcon from '@mui/icons-material/FilterList';
import HistoryIcon from '@mui/icons-material/History';
import React from 'react';
import { UnifiedValidityFlags } from '../macros';

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
  name: 'ForestGEO',
  description: 'Census data entry and storage',
  version: 'Acacia' // needs to be updated as new versions are released
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
  '/quadratpersonnel': 'quadratpersonnel'
};

export const siteConfigNav: SiteConfigProps[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    tip: 'Home Page',
    icon: DashboardIcon,
    expanded: []
  },
  {
    label: 'Census Hub',
    href: '/measurementshub',
    tip: 'View existing core measurement data for a given plot, census, and quadrat',
    icon: DataObjectIcon,
    expanded: [
      {
        label: 'View Data',
        href: '/summary',
        tip: '',
        icon: VisibilityIcon
      },
      {
        label: 'Uploaded Files',
        href: '/uploadedfiles',
        tip: 'uploaded file display',
        icon: CloudCircleIcon
      },
      {
        label: 'View All Historical Data',
        href: '/viewfulltable',
        tip: 'all historical data view',
        icon: HistoryIcon
      }
      // {
      //   label: "Validation History",
      //   href: "/validationhistory",
      //   tip: '',
      //   icon: HistoryEduIcon
      // },
    ]
  },

  {
    label: 'Stem & Plot Details',
    href: '/fixeddatainput',
    tip: 'View Modifiable Properties',
    icon: SettingsSuggestIcon,
    expanded: [
      {
        label: 'Stem Codes',
        href: '/attributes',
        tip: '',
        icon: DescriptionIcon
      },
      {
        label: 'Personnel',
        href: '/personnel',
        tip: '',
        icon: AccountCircleIcon
      },
      {
        label: 'Quadrats',
        href: '/quadrats',
        tip: '',
        icon: WidgetsIcon
      },
      {
        label: 'Species List',
        href: '/alltaxonomies',
        tip: '',
        icon: SchemaIcon
      },
      {
        label: 'Plot-Species List',
        href: '/stemtaxonomies',
        tip: '',
        icon: FilterIcon
      }
      // {
      //   label: 'Subquadrats',
      //   href: '/subquadrats',
      //   tip: '',
      //   icon: WidgetsIcon,
      // },
      // {
      //   label: 'QuadratPersonnel',
      //   href: '/quadratpersonnel',
      //   tip: '',
      //   icon: WidgetsIcon,
      // },
      // {
      //   label: 'Species',
      //   href: '/species',
      //   tip: '',
      //   icon: BugReportIcon,
      // },
      // {
      //   label: 'Measurements Form',
      //   href: '/measurementsform',
      //   tip: '',
      //   icon: DescriptionIcon,
      // },
    ]
  }
];

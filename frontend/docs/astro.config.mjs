// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import sentry from '@sentry/astro';
import spotlightjs from '@spotlightjs/astro';

// https://astro.build/config
export default defineConfig({
  site: 'https://smithsonian.github.io',
  base: '/ForestGEO',
  integrations: [
    starlight({
      title: 'ForestGEO Application Documentation',
      logo: {
        light: './src/assets/forestgeo-logo-light.svg',
        dark: './src/assets/forestgeo-logo-dark.svg',
        replacesTitle: false
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Smithsonian/ForestGEO' }],
      editLink: {
        baseUrl: 'https://github.com/Smithsonian/ForestGEO/edit/main/frontend/docs/'
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Onboarding & Getting Started',
          items: [
            { label: 'Quick Start', slug: 'quick-start' },
            { label: 'Getting Started', slug: 'getting-started' },
            { label: 'Navigation, Dashboard & Tools', slug: 'navigation-dashboard-tools' },
            { label: 'Adding Historical Data', slug: 'adding-historical-data' }
          ]
        },
        {
          label: 'Walking Through the Application',
          items: [
            { label: 'Upload Process Breakdown', slug: 'upload-process-breakdown' },
            { label: 'Understanding SAPD Datagrids', slug: 'understanding-sapd-datagrids' }
          ]
        },
        {
          label: 'Validations & Statistics',
          slug: 'validations-statistics'
        },
        {
          label: 'Administration',
          items: [{ label: 'Site Provisioning', slug: 'admin/site-provisioning' }]
        },
        {
          label: 'Error Guide & Troubleshooting',
          items: [
            { label: 'Error Guide Overview', slug: 'errors/error-guide-overview' },
            { label: 'Upload Errors', slug: 'errors/upload-errors' },
            { label: 'Validation Errors', slug: 'errors/validation-errors' },
            { label: 'Failed Measurements Guide', slug: 'errors/failed-measurements-guide' },
            { label: 'Authentication Errors', slug: 'errors/authentication-errors' },
            { label: 'System Errors', slug: 'errors/system-errors' },
            { label: 'Error FAQ', slug: 'errors/error-faq' }
          ]
        },
        {
          label: 'CTFSWeb Migration',
          collapsed: true,
          items: [
            { label: 'CTFSWeb vs ForestGEO Comparison', slug: 'migration/ctfsweb-forestgeo-comparison' },
            { label: 'Data Model Reference', slug: 'migration/ctfsweb-data-model' },
            { label: 'Data Specifications Guide', slug: 'migration/ctfsweb-data-specs' },
            { label: 'Publishing a Census to CTFSWeb', slug: 'migration/publishing-census-to-ctfs' }
          ]
        },
        {
          label: 'Documentation Framework',
          collapsed: true,
          items: [
            { label: 'Framework Overview', slug: 'framework/documentation-framework-overview' },
            { label: 'Table of Contents Outline', slug: 'framework/documentation-toc-outline' },
            { label: 'Glossary of Terms', slug: 'framework/glossary-of-terms' },
            { label: 'Process Flows Reference', slug: 'framework/process-flows-reference' },
            { label: 'Non-Technical User Guide', slug: 'framework/non-technical-user-guide-outline' },
            { label: 'Core Systems Reference', slug: 'framework/core-systems-reference' }
          ]
        }
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'description',
            content: 'Documentation for the ForestGEO Data Processing Application'
          }
        }
      ],
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 }
    }),
    sentry(),
    spotlightjs()
  ]
});

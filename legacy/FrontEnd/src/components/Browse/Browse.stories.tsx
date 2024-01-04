import {MemoryRouter} from 'react-router-dom';

import {ComponentMeta, Story} from '@storybook/react';
import {BrowsePure, BrowsePureProps} from './Browse';

export default {
  title: 'Browse',
  component: BrowsePure,
  argTypes: {},
} as ComponentMeta<typeof BrowsePure>;

const Template: Story<BrowsePureProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/Browse']}>
      <BrowsePure {...args} />
    </MemoryRouter>
  );
};

export const Loaded = Template.bind({});
Loaded.args = {
  isLoaded: true,
  plot: {
    plotName: 'some plot',
    plotNumber: 1,
  },
  setPlot: () => undefined,
  plotRows: {
    '33333847387434.csv': {
      user: 'aaaaaaaa@example.com',
      date: 'Thu Sep 15 2022',
    },
    'cocotreesandsuch.csv': {
      user: 'bbbbbbbbb@example.com',
      date: 'Mon Sep 19 2022',
    },
    'emptyvalues.csv': {
      user: 'Abba B.',
      date: 'Wed Sep 14 2022',
    },
  },
};

export const Loading = Template.bind({});
Loading.args = {
  isLoaded: false,
  setPlot: () => undefined,
  plot: {
    plotName: 'some plot',
    plotNumber: 1,
  },
};

export const ErrorLoading = Template.bind({});
ErrorLoading.args = {
  error: new Error('oops'),
  setPlot: () => undefined,
  plot: {
    plotName: 'some plot',
    plotNumber: 1,
  },
};

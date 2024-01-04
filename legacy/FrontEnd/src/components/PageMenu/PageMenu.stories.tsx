import {MemoryRouter} from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';

import {ComponentMeta, Story} from '@storybook/react';
import PageMenu, {PageMenuProps} from './PageMenu';

export default {
  title: 'PageMenu',
  component: PageMenu,
  argTypes: {},
} as ComponentMeta<typeof PageMenu>;

const Template: Story<PageMenuProps> = (args) => {
  return (
    <MemoryRouter>
      <AppBar position="static">
        <Toolbar>
          <PageMenu {...args} />
        </Toolbar>
      </AppBar>
    </MemoryRouter>
  );
};

/**
 * Initially if there is not a matching pathname, it defaults to Validate.
 */
export const ValidateSelected = Template.bind({});
ValidateSelected.args = {};

const BrowseTemplate: Story<PageMenuProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/browse']}>
      <AppBar position="static">
        <Toolbar>
          <PageMenu {...args} />
        </Toolbar>
      </AppBar>
    </MemoryRouter>
  );
};

/**
 * This shows that when the pathname is /browse the Browse menu item is selected.
 */
export const BrowseSelected = BrowseTemplate.bind({});
BrowseSelected.args = {};

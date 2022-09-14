import { MemoryRouter } from 'react-router-dom';

import { ComponentMeta, Story } from '@storybook/react';
import PageMenu, { PageMenuProps } from './PageMenu';

export default {
  title: 'PageMenu',
  component: PageMenu,
  argTypes: {},
} as ComponentMeta<typeof PageMenu>;

const Template: Story<PageMenuProps> = (args) => {
  return (
    <MemoryRouter>
      <PageMenu {...args} />
    </MemoryRouter>
  );
};

/**
 * Initially if there is not a matching pathname, it defaults to Validate.
 */
export const ValidateMenu = Template.bind({});
ValidateMenu.args = {};

const BrowseTemplate: Story<PageMenuProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/browse']}>
      <PageMenu {...args} />
    </MemoryRouter>
  );
};

/**
 * This shows that when the pathname is /browse the Browse menu item is selected.
 */
export const BrowseMenu = BrowseTemplate.bind({});
BrowseMenu.args = {};

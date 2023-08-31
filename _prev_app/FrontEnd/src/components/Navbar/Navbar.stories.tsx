import { ComponentMeta, Story } from '@storybook/react';
import { NavbarProps, NavbarPure } from './Navbar';
import { MemoryRouter } from 'react-router-dom';

export interface clientPrincipal {
  userId: string;
  userRoles: string[];
  claims: string[];
  identityProvider: string;
  userDetails: string;
}

export default {
  title: 'Navbar',
  component: NavbarPure,
  argTypes: {},
} as ComponentMeta<typeof NavbarPure>;

const Template: Story<NavbarProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/Navbar']}>
      <NavbarPure {...args} />
    </MemoryRouter>
  );
};

export const WithUser = Template.bind({});
WithUser.args = { userDetails: 'lalala' };

export const WithoutUser = Template.bind({});
WithoutUser.args = {};

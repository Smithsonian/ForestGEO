import {MemoryRouter} from 'react-router-dom';

import {ComponentMeta, Story} from '@storybook/react';
import {LoginPure, LoginPureProps} from './Login';

export default {
  title: 'Login',
  component: LoginPure,
  argTypes: {},
} as ComponentMeta<typeof LoginPure>;

const Template: Story<LoginPureProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/login']}>
      <LoginPure {...args} />
    </MemoryRouter>
  );
};

export const Login = Template.bind({});
Login.args = {};

import { ComponentMeta, Story } from '@storybook/react';
import Table, { TableProps } from '../components/Table';

export default {
  title: 'Table',
  component: Table,
  argTypes: {},
} as ComponentMeta<typeof Table>;

const Template: Story<TableProps> = (args) => <Table {...args} />;

export const NoError = Template.bind({});
NoError.args = {
  error: false,
  errorMessage: {},
};

export const Error = Template.bind({});
Error.args = {
  error: true,
  errorMessage: {
    5: 'ERROR: testing',
    3: 'ERROR: testing',
    0: 'ERROR: testing',
  },
};

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
  errorMessage: '',
};

export const Error = Template.bind({});
Error.args = {
  error: true,
  errorMessage: 'ERROR: testing',
};

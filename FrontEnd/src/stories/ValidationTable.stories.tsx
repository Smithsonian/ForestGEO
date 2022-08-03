import { ComponentMeta, Story } from '@storybook/react';
import ValidationTable, {
  ValidationTableProps,
} from '../components/ValidationTable';

export default {
  title: 'ValidationTable',
  component: ValidationTable,
  argTypes: {},
} as ComponentMeta<typeof ValidationTable>;

const Template: Story<ValidationTableProps> = (args) => (
  <ValidationTable {...args} />
);

export const NoError = Template.bind({});
NoError.args = {
  error: false,
  errorMessage: {},
  uploadedData: [],
};

export const Error = Template.bind({});
Error.args = {
  error: true,
  errorMessage: {
    5: 'ERROR: testing',
    3: 'ERROR: testing',
    0: 'ERROR: testing',
  },
  uploadedData: [],
};

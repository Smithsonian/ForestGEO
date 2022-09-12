import { ComponentMeta, Story } from '@storybook/react';
import { FileWithPath } from 'react-dropzone';
import ValidationTable, { ValidationTableProps } from './ValidationTable';

export default {
  title: 'ValidationTable',
  component: ValidationTable,
  argTypes: {},
} as ComponentMeta<typeof ValidationTable>;

const Template: Story<ValidationTableProps> = (args) => (
  <ValidationTable {...args} />
);

// @todo: need realistic example data for this validation table.

const uploadedData: FileWithPath[] = [];

export const NoError = Template.bind({});
NoError.args = {
  error: false,
  errorMessage: {},
  uploadedData: uploadedData,
};

export const Error = Template.bind({});
Error.args = {
  error: true,
  errorMessage: {
    filename: {
      0: 'ERROR: testing message 0',
      3: 'ERROR: testing message 3',
      5: 'ERROR: testing message 5',
    },
  },
  uploadedData: uploadedData,
};

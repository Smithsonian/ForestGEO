import { ComponentMeta, Story } from '@storybook/react';
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

const uploadedData = [
  {
    Tag: 'Tag0',
    Subquadrat: 'Subquadrat0',
    SpCode: 'SpCode0',
    DBH: 'DBH0',
    Htmeas: 'Htmeas0',
    Codes: 'Codes0',
    Comments: 'Comments0',
  },
  {
    Tag: 'Tag1',
    Subquadrat: 'Subquadrat1',
    SpCode: 'SpCode1',
    DBH: 'DBH1',
    Htmeas: 'Htmeas1',
    Codes: 'Codes1',
    Comments: 'Comments1',
  },
  {
    Tag: 'Tag2',
    Subquadrat: 'Subquadrat2',
    SpCode: 'SpCode2',
    DBH: 'DBH2',
    Htmeas: 'Htmeas2',
    Codes: 'Codes2',
    Comments: 'Comments2',
  },
  {
    Tag: 'Tag3',
    Subquadrat: 'Subquadrat3',
    SpCode: 'SpCode3',
    DBH: 'DBH3',
    Htmeas: 'Htmeas3',
    Codes: 'Codes3',
    Comments: 'Comments3',
  },
  {
    Tag: 'Tag4',
    Subquadrat: 'Subquadrat4',
    SpCode: 'SpCode4',
    DBH: 'DBH4',
    Htmeas: 'Htmeas4',
    Codes: 'Codes4',
    Comments: 'Comments4',
  },
  {
    Tag: 'Tag5',
    Subquadrat: 'Subquadrat5',
    SpCode: 'SpCode5',
    DBH: 'DBH5',
    Htmeas: 'Htmeas5',
    Codes: 'Codes5',
    Comments: 'Comments5',
  },
];

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
    0: 'ERROR: testing message 0',
    3: 'ERROR: testing message 3',
    5: 'ERROR: testing message 5',
  },
  uploadedData: uploadedData,
};

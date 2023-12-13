import {ComponentMeta, Story} from '@storybook/react';
import {FileWithPath} from 'react-dropzone';
import ValidationTable, {ValidationTableProps} from './ValidationTable';

export default {
  title: 'ValidationTable',
  component: ValidationTable,
  argTypes: {},
} as ComponentMeta<typeof ValidationTable>;

const Template: Story<ValidationTableProps> = (args) => (
  <ValidationTable {...args} />
);

const HEADERS = [
  {label: 'Tag'},
  {label: 'Subquadrat'},
  {label: 'SpCode'},
  {label: 'DBH'},
  {label: 'Htmeas'},
  {label: 'Codes'},
  {label: 'Comments'},
];

// some example uploaded data
const uploadedData: FileWithPath[] = [
  new File(
    [
      new Blob(
        [
          [
            'Tag,Subquadrat,SpCode,DBH,Htmeas,Codes,Comments',
            'Tag0,Subquadrat0,SpCode0,DBH0,Htmeas0,Codes0,Comment0',
            'Tag1,Subquadrat1,SpCode1,DBH1,Htmeas1,Codes1,Comment1',
            'Tag2,Subquadrat2,SpCode2,DBH2,Htmeas2,Codes2,Comment2',
            'Tag3,Subquadrat3,SpCode3,DBH3,Htmeas3,Codes3,Comment3',
            'Tag4,Subquadrat4,SpCode4,DBH4,Htmeas4,Codes4,Comment4',
            'Tag5,Subquadrat5,SpCode5,DBH5,Htmeas5,Codes5,Comment5',
          ].join('\n'),
        ],
        {type: 'text/plain'}
      ),
    ],
    'test1.csv',
    {lastModified: new Date().getTime()}
  ),
  new File(
    [
      new Blob(
        [
          [
            'Tag,Subquadrat,SpCode,DBH,Htmeas,Codes,Comments',
            'Tag0,Subquadrat0,SpCode0,DBH0,Htmeas0,Codes0,Comment0',
            'Tag1,Subquadrat1,SpCode1,DBH1,Htmeas1,Codes1,Comment1',
            'Tag2,Subquadrat2,SpCode2,DBH2,Htmeas2,Codes2,Comment2',
            'Tag3,Subquadrat3,SpCode3,DBH3,Htmeas3,Codes3,Comment3',
            'Tag4,Subquadrat4,SpCode4,DBH4,Htmeas4,Codes4,Comment4',
            'Tag5,Subquadrat5,SpCode5,DBH5,Htmeas5,Codes5,Comment5',
          ].join('\n'),
        ],
        {type: 'text/plain'}
      ),
    ],
    'test2.csv',
    {lastModified: new Date().getTime()}
  ),
];

export const NoError = Template.bind({});
NoError.args = {
  errorMessage: {
    'test1.csv': {},
    'test2.csv': {},
  },
  uploadedData: uploadedData,
  headers: HEADERS,
};

export const Error = Template.bind({});
Error.args = {
  errorMessage: {
    'test1.csv': {
      0: 'ERROR: testing error message on row 0',
      3: 'ERROR: testing error message on row 3',
      4: 'ERROR: testing error message on row 4',
    },
    'test2.csv': {
      1: 'ERROR: testing error message on row 1',
    },
  },
  uploadedData: uploadedData,
  headers: HEADERS,
};

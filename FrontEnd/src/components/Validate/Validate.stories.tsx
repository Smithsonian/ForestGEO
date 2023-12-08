import {MemoryRouter} from 'react-router-dom';
import {ComponentMeta, Story} from '@storybook/react';
import {ValidatePure, ValidatePureProps} from './Validate';

export default {
  title: 'Validate',
  component: ValidatePure,
  argTypes: {
    label: {control: 'text'},
    onClick: {action: 'clicked'},
  },
} as ComponentMeta<typeof ValidatePure>;

const Template: Story<ValidatePureProps> = (args) => {
  return (
    <MemoryRouter initialEntries={['/validate']}>
      <ValidatePure {...args} />
    </MemoryRouter>
  );
};

export const Uploading = Template.bind({});
Uploading.args = {
  uploadDone: false,
  isUploading: true,
  plot: {
    plotName: 'some plot',
    plotNumber: 1,
  },
  errorsData: {},
  acceptedFiles: [],
  setPlot: () => undefined,
  handleUpload: async () => undefined,
  handleAcceptedFiles: () => undefined,
};

export const Uploaded = Template.bind({});
Uploaded.args = {
  uploadDone: true,
  isUploading: false,
  plot: {
    plotName: 'some plot',
    plotNumber: 1,
  },
  errorsData: {},
  acceptedFiles: [
    new File(['foo'], 'foow.csv', {
      type: 'text/plain',
    }),
    new File(['foo'], 'foo.csv', {
      type: 'text/plain',
    }),
  ],
  setPlot: () => undefined,
  handleUpload: async () => undefined,
  handleAcceptedFiles: () => undefined,
};

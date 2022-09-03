import React from 'react';
import { ComponentMeta, Story } from '@storybook/react';
import Dropzone, {
  DropzonePure,
  DropzonePureProps,
  DropzoneProps,
} from './Dropzone';

export default {
  title: 'Dropzone',
  component: DropzonePure,
  argTypes: {},
} as ComponentMeta<typeof DropzonePure>;

const Template: Story<DropzonePureProps> = (args) => <DropzonePure {...args} />;

export const NoDrop = Template.bind({});
NoDrop.args = {
  isDragActive: false,
  getRootProps: () => null,
  getInputProps: () => null,
};

export const Dropping = Template.bind({});
Dropping.args = {
  isDragActive: true,
  getRootProps: () => null,
  getInputProps: () => null,
};

const TemplateDropzone: Story<DropzoneProps> = (args) => <Dropzone {...args} />;

export const DropzoneActive = TemplateDropzone.bind({});
DropzoneActive.args = { onChange: () => null };

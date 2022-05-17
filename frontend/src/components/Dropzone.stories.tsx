import React from 'react';
import { ComponentMeta, Story } from '@storybook/react';
import { DropzonePure, DropzonePureProps } from './Dropzone';

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

export const Drop = Template.bind({});
Drop.args = {
  isDragActive: true,
  getRootProps: () => null,
  getInputProps: () => null,
};

import { ComponentMeta, Story } from '@storybook/react';
import FileList, { FileListProps } from './FileList';

export default {
  title: 'FileList',
  component: FileList,
  argTypes: {},
} as ComponentMeta<typeof FileList>;

const Template: Story<FileListProps> = (args) => <FileList {...args} />;

export const SomeFiles = Template.bind({});
SomeFiles.args = {
  acceptedFiles: [
    { path: 'meow.csv', size: 22 },
    { path: 'what-does-the-fox-say.csv', size: 243344444442 },
  ],
};

export const NoFiles = Template.bind({});
NoFiles.args = {
  acceptedFiles: [],
};

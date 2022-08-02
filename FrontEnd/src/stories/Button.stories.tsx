import { Button } from '@mui/material';
import { ComponentMeta, Story } from '@storybook/react';
import ButtonComponent, { ButtonProps } from '../components/Button';

export default {
  title: 'Button',
  component: ButtonComponent,
  argTypes: {
    label: { control: 'text' },
    onClick: { action: 'clicked' },
  },
} as ComponentMeta<typeof ButtonComponent>;

const Template: Story<ButtonProps> = (args) => <Button {...args} />;

export const UploadButton = Template.bind({});
UploadButton.args = {
  label: 'UPLOAD',
};

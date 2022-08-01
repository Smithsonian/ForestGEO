import { ComponentMeta, Story } from '@storybook/react';
import Button, { ButtonProps } from '../components/Button';

export default {
  title: 'Button',
  component: Button,
  argTypes: {
    label: { control: 'text' },
    backgroundColor: { control: 'text' },
    onClick: { action: 'clicked' },
  },
} as ComponentMeta<typeof Button>;

const Template: Story<ButtonProps> = (args) => <Button {...args} />;

export const UploadButton = Template.bind({});
UploadButton.args = {
  label: 'UPLOAD',
  backgroundColor: '#0F5530',
  textColor: 'white',
};

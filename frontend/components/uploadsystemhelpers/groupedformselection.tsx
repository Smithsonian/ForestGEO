import * as React from 'react';
import Select from '@mui/joy/Select';
import Option, { optionClasses } from '@mui/joy/Option';
import Chip from '@mui/joy/Chip';
import List from '@mui/joy/List';
import ListItemDecorator, { listItemDecoratorClasses } from '@mui/joy/ListItemDecorator';
import ListDivider from '@mui/joy/ListDivider';
import ListItem from '@mui/joy/ListItem';
import Typography from '@mui/joy/Typography';
import Check from '@mui/icons-material/Check';
import { FormGroups, TableHeadersByFormType } from '@/config/macros/formdetails';

interface SelectFormTypeProps {
  externalState: string;
  updateExternalState: React.Dispatch<React.SetStateAction<string>>;
  updateExternalHeaders: React.Dispatch<React.SetStateAction<string[]>>;
}

const SelectFormType: React.FC<SelectFormTypeProps> = ({ externalState, updateExternalState, updateExternalHeaders }) => {
  const colors: Record<string, 'neutral' | 'primary'> = {
    DatabaseForms: 'neutral',
    CTFSWebForms: 'primary'
  };
  const handleChange = (event: React.SyntheticEvent | null, newValue: string | null) => {
    if (newValue) {
      updateExternalState(newValue!);
      updateExternalHeaders(TableHeadersByFormType[newValue!].map(item => item.label));
    }
  };

  return (
    <Select
      placeholder="Choose a form"
      slotProps={{
        listbox: {
          component: 'div',
          sx: {
            maxHeight: 240,
            overflow: 'auto',
            '--List-padding': '0px',
            '--ListItem-radius': '0px'
          }
        }
      }}
      value={externalState}
      onChange={handleChange}
      sx={{ display: 'flex', flex: 1 }}
    >
      {Object.entries(FormGroups).map(([name, forms], index) => (
        <React.Fragment key={name}>
          {index !== 0 && <ListDivider role="none" />}
          <List aria-labelledby={`select-group-${name}`} sx={{ '--ListItemDecorator-size': '28px' }}>
            <ListItem id={`select-group-${name}`} sticky>
              <Typography level="body-xs" textTransform="uppercase">
                {name} ({forms.length})
              </Typography>
            </ListItem>
            {forms.map(form => (
              <Option
                key={form}
                value={form}
                label={
                  <React.Fragment>
                    <Chip size="sm" color={colors[name]} sx={{ borderRadius: 'xs', mr: 1 }}>
                      {name}
                    </Chip>{' '}
                    {form}
                  </React.Fragment>
                }
                sx={{
                  [`&.${optionClasses.selected} .${listItemDecoratorClasses.root}`]: {
                    opacity: 1
                  }
                }}
              >
                <ListItemDecorator sx={{ opacity: 0 }}>
                  <Check />
                </ListItemDecorator>
                {form}
              </Option>
            ))}
          </List>
        </React.Fragment>
      ))}
    </Select>
  );
};

export default SelectFormType;

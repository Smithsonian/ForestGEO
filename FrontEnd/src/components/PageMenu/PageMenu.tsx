import * as React from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import { useLocation, useNavigate } from 'react-router-dom';

const OPTIONS = ['Validate', 'Report', 'Browse'];
const LOCATIONS = ['/validate', '/report', '/browse'];

export interface PageMenuProps {}

/**
 * Allows selecting pages from a menu.
 *
 * Shows the selected menu item depending on the route pathname.
 *
 * Is responsive. Shows a menu on mobile, and shows links on desktop.
 */
export default function PageMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);

  // The menu can start depending on the pathname.
  const [selectedIndex, setSelectedIndex] = React.useState(
    LOCATIONS.indexOf(location.pathname) === -1
      ? 0
      : LOCATIONS.indexOf(location.pathname)
  );

  // If the route changes, then we change the selected menu too.
  React.useEffect(() => {
    if (LOCATIONS.indexOf(location.pathname) !== -1) {
      setSelectedIndex(LOCATIONS.indexOf(location.pathname));
    }
  }, [location.pathname]);

  const open = Boolean(anchorEl);
  const handleClickListItem = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuItemClick = (
    event: React.MouseEvent<HTMLElement>,
    index: number
  ) => {
    setSelectedIndex(index);
    setAnchorEl(null);
    navigate(LOCATIONS[index]);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }}>
        {OPTIONS.map((page, index) => (
          <Button
            key={page}
            onClick={(event) => handleMenuItemClick(event, index)}
            sx={{
              my: 2,
              color: 'white',
              display: 'block',
            }}
            color={index === selectedIndex ? 'secondary' : 'primary'}
            variant={index === selectedIndex ? 'outlined' : 'text'}
          >
            {page}
          </Button>
        ))}
      </Box>
      <Box
        sx={{
          display: { xs: 'block', md: 'none' },
        }}
      >
        <Button
          id="open-menu-button"
          aria-haspopup="listbox"
          aria-controls="nav-menu"
          aria-label="opens menu"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClickListItem}
        >
          {OPTIONS[selectedIndex]}
        </Button>
        <Menu
          id="nav-menu"
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          MenuListProps={{
            'aria-labelledby': 'open-menu-button',
            role: 'listbox',
          }}
        >
          {OPTIONS.map((option, index) => (
            <MenuItem
              key={option}
              selected={index === selectedIndex}
              onClick={(event) => handleMenuItemClick(event, index)}
            >
              {option}
            </MenuItem>
          ))}
        </Menu>
      </Box>
    </>
  );
}

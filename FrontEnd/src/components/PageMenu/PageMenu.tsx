import * as React from 'react';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import { useLocation, useNavigate } from 'react-router-dom';

const OPTIONS = ['Validate', 'Report', 'Browse'];
const LOCATIONS = ['/validate', '/report', '/browse'];

// @todo: Show the 3 pages in the app bar when it's not mobile view.
//   In mobile view, use the menu as it is now.
//   See https://mui.com/material-ui/react-app-bar/#app-bar-with-responsive-menu

export interface PageMenuProps {}

/**
 * Allows selecting pages from a menu.
 *
 * Shows the selected menu item depending on the pathname.
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
      <Button
        id="lock-button"
        aria-haspopup="listbox"
        aria-controls="lock-menu"
        aria-label="when device is locked"
        aria-expanded={open ? 'true' : undefined}
        onClick={handleClickListItem}
      >
        {OPTIONS[selectedIndex]}
      </Button>
      <Menu
        id="lock-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'lock-button',
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
    </>
  );
}

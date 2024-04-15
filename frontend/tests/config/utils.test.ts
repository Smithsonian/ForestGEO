import {closeSidebar, openSidebar, toggleSidebar} from '@/config/utils';
import '@testing-library/jest-dom';

describe('Sidebar functionality', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '');
  });

  it('openSidebar should set body overflow to hidden and add --SideNavigation-slideIn property', () => {
    openSidebar();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
  });

  it('closeSidebar should remove --SideNavigation-slideIn property and body overflow style', () => {
    closeSidebar();
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');
    expect(document.body.style.overflow).toBe('');
  });

  it('toggleSidebar should open the sidebar if it is closed', () => {
    document.documentElement.style.removeProperty('--SideNavigation-slideIn');
    toggleSidebar();
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('1');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('toggleSidebar should close the sidebar if it is open', () => {
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '1');
    toggleSidebar();
    expect(document.documentElement.style.getPropertyValue('--SideNavigation-slideIn')).toBe('');
    expect(document.body.style.overflow).toBe('');
  });
});

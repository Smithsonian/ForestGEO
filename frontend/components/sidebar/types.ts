/**
 * Sidebar Component Types
 *
 * Shared types for the decomposed sidebar components
 */

export interface SidebarProps {
  siteListLoaded: boolean;
  coreDataLoaded: boolean;
  setCensusListLoaded: (loaded: boolean) => void;
  setManualReset: (reset: boolean) => void;
}

export interface SelectorProps {
  className?: string;
}

export interface RenderValueProps {
  label: string;
  details?: string[];
}

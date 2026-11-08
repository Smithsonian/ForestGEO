import type { ViewDataShowOption, ViewDataStateCounts } from '@/config/viewdata';

/** What MeasurementsCommons hands to its renderAboveGrid slot (the View Data header and filter bar). */
export interface ViewDataAboveGridControls {
  stateCounts: ViewDataStateCounts | null;
  showOption: ViewDataShowOption;
  onShowOptionChange: (next: ViewDataShowOption) => void;
  searchText: string;
  appliedSearchText: string;
  onSearchTextChange: (text: string) => void;
  onSearchApply: () => void;
  onSearchClear: () => void;
  onRunValidations: () => void;
  onOverrideValidations: () => void;
  onResetValidations: () => void;
  onOpenExport: () => void;
}

import * as React from "react";
import { useCallback } from "react";

type FormState = {
  isDirty: boolean;
};
type FormIsDirtyDispatch = (isDirty: boolean) => void;
type FormProviderProps = { children: React.ReactNode };

const FormIsDirtyStateContext = React.createContext<boolean>(false);
const FormIsDirtyDispatchContext = React.createContext<
  FormIsDirtyDispatch | undefined
>(undefined);

/**
 * Form context provider.
 * Currently provide :
 *     1) if form isDirty,
 *     2) dispatch function to update isDirty
 */
function FormProvider({ children }: FormProviderProps) {
  const [{ isDirty }, setIsDirty] = React.useState<FormState>({
    isDirty: false,
  });

  const setIsDiretyCallback = useCallback(
    (newData) => setIsDirty({ isDirty: newData }),
    [setIsDirty]
  );

  return (
    <FormIsDirtyStateContext.Provider value={isDirty}>
      <FormIsDirtyDispatchContext.Provider value={setIsDiretyCallback}>
        {children}
      </FormIsDirtyDispatchContext.Provider>
    </FormIsDirtyStateContext.Provider>
  );
}

function useFormIsDirtyState() {
  const context = React.useContext(FormIsDirtyStateContext);

  if (context === undefined) {
    throw new Error("useFormState must be used within a FormProvider");
  }

  return context;
}

function useFormIsDirtyDispatch() {
  const context = React.useContext(FormIsDirtyDispatchContext);

  if (context === undefined) {
    throw new Error("useFormDispatch must be used within a FormProvider");
  }

  return context;
}

export { FormProvider, useFormIsDirtyState, useFormIsDirtyDispatch };

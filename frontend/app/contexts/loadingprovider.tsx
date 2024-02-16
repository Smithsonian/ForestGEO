"use client"

import React, {createContext, Dispatch, useContext, useReducer} from "react";

export const LoadingContext = createContext(false);
export const LoadingDispatchContext = createContext<Dispatch<{ loading: boolean }> | null>(null);

export default function LoadingProvider({children}: Readonly<{ children: React.ReactNode }>) {
  const [loading, loadingDispatch] = useReducer(
    loadingReducer,
    false
  );

  return (
    <LoadingContext.Provider value={loading}>
      <LoadingDispatchContext.Provider value={loadingDispatch}>
        {children}
      </LoadingDispatchContext.Provider>
    </LoadingContext.Provider>
  );
}

function loadingReducer(_currentState: any, action: { loading: boolean }) {
  return action.loading;
}

export function useLoadingContext() {
  return useContext(LoadingContext);
}

export function useLoadingDispatch() {
  return useContext(LoadingDispatchContext);
}
// contextreducers.ts
import { Dispatch } from 'react';
import { Plot, QuadratRDS, Site } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus } from '@/config/sqlrdsdefinitions/timekeeping';
import { submitCookie } from '@/app/actions/cookiemanager';

// Define a type for the enhanced dispatch function
export type EnhancedDispatch<T> = (payload: Record<string, T | undefined>) => Promise<void>;

export function createEnhancedDispatch<T>(dispatch: Dispatch<LoadAction<T>>, actionType: string): EnhancedDispatch<T> {
  return async (payload: Record<string, T | undefined>) => {
    if (payload[actionType] !== undefined) {
      if (actionType === 'site') await submitCookie('schema', (payload[actionType] as unknown as Site)?.schemaName ?? '');
      else if (actionType === 'plot') await submitCookie('plotID', (payload[actionType] as unknown as Plot)?.plotID?.toString() ?? '');
      else if (actionType === 'census') await submitCookie('censusID', (payload[actionType] as unknown as OrgCensus)?.dateRanges[0].censusID?.toString() ?? '');
      else if (actionType === 'quadrat') await submitCookie('quadratID', (payload[actionType] as unknown as QuadratRDS)?.quadratID?.toString() ?? '');
      else if (actionType === 'censusList') await submitCookie('censusList', JSON.stringify(payload[actionType] as unknown as OrgCensus[]));
    }
    dispatch({ type: actionType, payload });
  };
}

export interface LoadAction<T> {
  type: string;
  payload: Record<string, T | undefined>;
}

// Generic reducer function
export function genericLoadReducer<T>(state: T | undefined, action: LoadAction<T>): T | undefined {
  switch (action.type) {
    case 'censusList':
    case 'plotList':
    case 'quadratList':
    case 'subquadratList':
    case 'siteList':
      if (action.payload && action.type in action.payload) {
        return action.payload[action.type];
      } else {
        return state;
      }
    default:
      return state;
  }
}

export function genericLoadContextReducer<T>(
  currentState: T | undefined,
  action: LoadAction<T>,
  listContext: T[],
  validationFunction?: (list: T[], item: T) => boolean
): T | undefined {
  // Check if the action type is one of the specified types
  const isRecognizedActionType = ['plot', 'census', 'quadrat', 'site', 'subquadrat'].includes(action.type);
  if (!isRecognizedActionType) {
    return currentState;
  }

  // Check if payload exists and action type is valid key in payload
  if (!action.payload || !(action.type in action.payload)) {
    return currentState;
  }

  const item = action.payload[action.type];
  // Reset state to undefined if item is undefined
  if (item === undefined) return undefined;

  // Use validation function if provided and return current state if item is invalid
  if (validationFunction && !validationFunction(listContext, item)) {
    return currentState;
  }

  // Return the item if it's in the list context or no validation is needed
  return !validationFunction || listContext.includes(item) ? item : currentState;
}

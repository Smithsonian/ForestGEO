// contextreducers.ts
import {Dispatch} from "react";
import {setData} from "../db";

// Define a type for the enhanced dispatch function
export type EnhancedDispatch<T> = (payload: { [key: string]: T | undefined }) => Promise<void>;

export function createEnhancedDispatch<T>(
  dispatch: Dispatch<LoadAction<T>>,
  actionType: string
): EnhancedDispatch<T> {
  return async (payload: { [key: string]: T | undefined }) => {
    // Save to IndexedDB only if payload is not undefined
    // await setData(actionType, payload[actionType] !== undefined ? payload[actionType] : undefined); // gonna comment this out temporarily, it seems to be causing issues
    // Dispatch the action
    dispatch({type: actionType, payload});
  };
}

export type LoadAction<T> = {
  type: string;
  payload: { [key: string]: T | undefined };
};

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
  return (!validationFunction || listContext.includes(item)) ? item : currentState;
}

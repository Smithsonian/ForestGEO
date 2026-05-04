import { useCallback, useEffect, useRef, useState } from 'react';

export interface DebouncedFilterModelApi<TModel> {
  uiModel: TModel;
  serverModel: TModel;
  applyChange: (partial: Partial<TModel> | TModel) => void;
  flush: () => void;
}

type Equals<TModel> = (a: TModel, b: TModel) => boolean;

export function useDebouncedFilterModel<TModel extends object>(
  initial: TModel,
  debounceMs: number,
  equals: Equals<TModel>,
  sanitise: (model: TModel) => TModel = m => m,
  onCommit?: (nextServerModel: TModel, previousServerModel: TModel) => void
): DebouncedFilterModelApi<TModel> {
  const [uiModel, setUiModel] = useState<TModel>(initial);
  const [serverModel, setServerModel] = useState<TModel>(() => sanitise(initial));

  const uiModelRef = useRef(uiModel);
  const serverModelRef = useRef(serverModel);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    uiModelRef.current = uiModel;
  }, [uiModel]);

  useEffect(() => {
    serverModelRef.current = serverModel;
  }, [serverModel]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const commit = useCallback(() => {
    const nextServer = sanitise(uiModelRef.current);
    const previousServer = serverModelRef.current;
    if (equals(previousServer, nextServer)) return;
    serverModelRef.current = nextServer;
    onCommit?.(nextServer, previousServer);
    setServerModel(nextServer);
  }, [equals, onCommit, sanitise]);

  const applyChange = useCallback(
    (partial: Partial<TModel> | TModel) => {
      const nextUi = { ...uiModelRef.current, ...partial } as TModel;
      uiModelRef.current = nextUi;
      setUiModel(nextUi);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(commit, debounceMs);
    },
    [commit, debounceMs]
  );

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit();
  }, [commit]);

  return { uiModel, serverModel, applyChange, flush };
}

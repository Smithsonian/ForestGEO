import localforage from "localforage";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type StorageProviderProps = {
  children: ReactNode;
};

type StorageContext = {
  userInputStore: LocalForage | undefined;
  latestCensusStore: LocalForage | undefined;
};

const StorageStateContext = createContext<StorageContext>({
  userInputStore: undefined,
  latestCensusStore: undefined,
});

function StorageProvider({ children }: StorageProviderProps) {
  const [userInputStore, setUserInputStore] = useState<LocalForage | undefined>(
    undefined
  );

  const [latestCensusStore, setLatestCensusStore] = useState<
    LocalForage | undefined
  >(undefined);

  useEffect(() => {
    // create IndexedDB
    const userInputTable = localforage.createInstance({
      name: "ForestGEO App Storage",
      storeName: "user-input-store",
      description:
        "The local storage for user input records that are validated locally.",
    });

    const latestCensusTable = localforage.createInstance({
      name: "ForestGEO App Storage",
      storeName: "latest-census-store",
      description:
        "The local storage for latest census data cache from the cloud. Use only for validation.",
    });

    setUserInputStore(userInputTable);
    setLatestCensusStore(latestCensusTable);
  }, []);

  return (
    <StorageStateContext.Provider
      value={{
        latestCensusStore,
        userInputStore,
      }}
    >
      {children}
    </StorageStateContext.Provider>
  );
}

function useStorageContext() {
  const context = useContext(StorageStateContext);

  if (context === undefined) {
    throw new Error("useStorageState must be used within a StorageProvider");
  }

  return context;
}

export { StorageProvider, useStorageContext, StorageStateContext };

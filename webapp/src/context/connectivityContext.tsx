import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type ConnectivityProviderProps = {
  children: ReactNode;
};

type ConnectivityContext = {
  isOnline: boolean;
};

const ConnectivityStateContext = createContext<ConnectivityContext>({
  isOnline: true,
});

function ConnectivityProvider({ children }: ConnectivityProviderProps) {
  const [online, setOnline] = useState(navigator.onLine);

  function handleOnline() {
    setOnline(true);
  }

  function handleOffline() {
    setOnline(false);
  }

  useEffect(() => {
    // Register event listeners for network status change.
    // Note the initial network status when app load comes from navigator.onLine.
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setOnline]);

  return (
    <ConnectivityStateContext.Provider
      value={{
        isOnline: online,
      }}
    >
      {children}
    </ConnectivityStateContext.Provider>
  );
}

function useConnectivityContext() {
  const context = useContext(ConnectivityStateContext);

  if (context === undefined) {
    throw new Error(
      "useConnectivityState must be used within a ConnectivityProvider"
    );
  }

  return context;
}

export {
  ConnectivityProvider,
  useConnectivityContext,
  ConnectivityStateContext,
};

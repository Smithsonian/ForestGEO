import { Switch, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import localforage from "localforage";

import { Home } from "./home";
import { New } from "./new";

export const Main = () => {
  const [online, setOnline] = useState(navigator.onLine);

  function handleOnline() {
    setOnline(true);
  }

  function handleOffline() {
    setOnline(false);
  }

  useEffect(() => {
    // Test IndexedDB
    const userInputStore = localforage.createInstance({
      name: "ForestGEO App Storage",
      storeName: "user-input-store",
      description:
        "The local storage for user input records that are validated locally.",
    });

    const latestCensusStore = localforage.createInstance({
      name: "ForestGEO App Storage",
      storeName: "latest-census-store",
      description:
        "The local storage for latest census data cache from the cloud. Use only for validation.",
    });

    userInputStore.setItem("1", {
      Subquadrat: "11",
      Tag: 1,
      SpCode: "species",
      DBH: 10,
      Htmeas: 1.5,
      Codes: "at",
      Comments: "",
    });

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
    <main>
      <span>{online ? "Online" : "Offline"}</span>
      <Switch>
        <Route strict={false} exact path="/">
          <Home />
        </Route>
        <Route path="/new">
          <New />
        </Route>
      </Switch>
    </main>
  );
};

Main.defaultName = "Main";

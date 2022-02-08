import { Switch, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { ProgressIndicator } from "@fluentui/react/lib/ProgressIndicator";

import { Home } from "./home";
import { New } from "./new";
import { useConnectivityContext } from "../context/connectivityContext";
import { useStorageContext } from "../context/storageContext";
import { getAllItems } from "../helpers/storageHelper";

import "./main.css";
import { FormProvider } from "../context/formContext";

const uploadWorker: Worker = new Worker("./workers/upload-worker.js");

export const Main = () => {
  const { isOnline } = useConnectivityContext();
  const { userInputStore } = useStorageContext();

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState(undefined);

  useEffect(() => {
    // Ask web worker to upload local user data when online
    if (userInputStore != null && isOnline) {
      getAllItems(userInputStore).then((data) => {
        if (data && data.length > 0) {
          setIsUploading(true);
          uploadWorker.postMessage(data);
        }
      });
    }

    uploadWorker.onmessage = (event: MessageEvent) => {
      const { data } = event;
      setIsUploading(false);
      if (data.succeeded) {
        // Clear local data once upload succeeded.
        userInputStore?.clear();
      } else {
        setUploadError(data.error);
      }
    };
  }, [uploadWorker, userInputStore, isOnline, setIsUploading]);

  return (
    <main className="content">
      {isUploading ? (
        <ProgressIndicator
          label="Uploading data"
          description="Uploading local data to the cloud"
        />
      ) : undefined}
      {uploadError !== undefined ? <span>{uploadError}</span> : undefined}
      <Switch>
        <Route strict={false} exact path="/">
          <Home />
        </Route>
        <Route path="/new">
          <FormProvider>
            <New />
          </FormProvider>
        </Route>
      </Switch>
    </main>
  );
};

Main.defaultName = "Main";

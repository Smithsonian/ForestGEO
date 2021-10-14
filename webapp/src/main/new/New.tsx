import { useState, useMemo, useEffect } from "react";
import { Shimmer, ShimmerElementType } from "@fluentui/react/lib/Shimmer";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { columns } from "./QuadratDataEntryForm/columnHeaders";

import {
  postValidate,
  PostValidationError,
} from "../../validation/postValidation";
import { getCensus, insertCensus } from "./dataService";
import { Tree } from "../../types";
import { useStorageContext } from "../../context/storageContext";
import { useConnectivityContext } from "../../context/connectivityContext";
import { getAllItems } from "../../helpers/storageHelper";

export const New = () => {
  const { latestCensusStore, userInputStore } = useStorageContext();
  const { isOnline } = useConnectivityContext();

  const [errors, setErrors] = useState<any>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Table data has to be memoized for react-table performance
  const columnHeaders = useMemo(() => columns, []);
  const [data, setData] = useState<Tree[]>([]);
  const [postValidationErrors, setPostValidationErrors] = useState<
    PostValidationError[]
  >([]);

  useEffect(() => {
    if (isOnline) {
      setIsLoading(true);
      getCensus().then((response) => {
        setData(response);
        setIsLoading(false);

        // Refresh storage
        latestCensusStore
          ?.clear()
          .then(() =>
            response.forEach((census) =>
              latestCensusStore
                ?.setItem(census.CensusId.toString(), census)
                .catch((error) => console.error(error))
            )
          )
          .catch((error) => console.error(error));
      });
    } else if (latestCensusStore) {
      // Get the latest census from local when offline
      getAllItems<Tree>(latestCensusStore).then((localCensus) =>
        setData(localCensus)
      );
    }
  }, [isOnline, latestCensusStore, setIsLoading, setData]);

  const updateData = (rowIndex: number, columnId: string, value: any) => {
    console.log(`set data for ${columnId} at row ${rowIndex} to ${value}`);

    setData((old) =>
      old.map((row, index) => {
        if (index === rowIndex) {
          return {
            ...old[rowIndex],
            [columnId]: value,
          };
        }
        return row;
      })
    );
  };

  return (
    <>
      <h1>Old Trees Form</h1>
      <QuadratMetadataEntryForm />
      {isLoading ? (
        <Shimmer
          shimmerElements={[
            { type: ShimmerElementType.line, height: 16, width: "20%" },
            { type: ShimmerElementType.gap, width: "2%" },
            { type: ShimmerElementType.line, height: 16, width: "20%" },
            { type: ShimmerElementType.gap, width: "2%" },
            { type: ShimmerElementType.line, height: 16, width: "20%" },
            { type: ShimmerElementType.gap, width: "2%" },
            { type: ShimmerElementType.line, height: 16, width: "20%" },
            { type: ShimmerElementType.gap, width: "2%" },
            { type: ShimmerElementType.line, height: 16 },
          ]}
        />
      ) : (
        <>
          <QuadratDataEntryForm
            columns={columnHeaders}
            data={data}
            updateHandler={updateData}
            postValidationErrors={postValidationErrors}
          />
          <button
            type="submit"
            onClick={() => {
              const postErrors = postValidate(data);
              setPostValidationErrors(postErrors);
              if (postErrors.length === 0) {
                if (isOnline) {
                  // Submit to cloud when online
                  insertCensus(data).catch((error) => setErrors(error));
                } else {
                  // Save locally when offline
                  data.forEach((census) =>
                    userInputStore
                      ?.setItem(census.CensusId.toString(), census)
                      .catch((error) => console.error(error))
                  );
                }
              }
            }}
          >
            Submit
          </button>
          <ul>
            {errors.map((error: any) => (
              <li>
                There was an error on the tree branch identified by subquadrat{" "}
                {error.Subquadrat}, tag {error.Tag} and stem {error.StemTag}:{" "}
                {error.Error}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
};

New.defaultName = "New";

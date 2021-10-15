import { useState, useMemo, useEffect } from "react";
import { Shimmer, ShimmerElementType } from "@fluentui/react/lib/Shimmer";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { columns } from "./QuadratDataEntryForm/columnHeaders";
import { preValidate } from "../../validation/preValidation";
import { postValidate } from "../../validation/postValidation";
import { ValidationErrorMap } from "../../validation/validationError";

import { getCensus, insertCensus } from "./dataService";
import { Tree } from "../../types";
import { useStorageContext } from "../../context/storageContext";
import { useConnectivityContext } from "../../context/connectivityContext";
import { getAllItems } from "../../helpers/storageHelper";
import { getDataForForm } from "../../helpers/formHelper";

export const New = () => {
  const { latestCensusStore, userInputStore } = useStorageContext();
  const { isOnline } = useConnectivityContext();

  const [errors, setErrors] = useState<any>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Table data has to be memoized for react-table performance
  const columnHeaders = useMemo(() => columns, []);
  const [validationErrors, setValidationErrors] = useState(
    new ValidationErrorMap()
  );
  const [hackyForceRerender, setHackyForceRerender] = useState(false);
  const [data, setData] = useState<Tree[]>([]);

  useEffect(() => {
    if (isOnline) {
      setIsLoading(true);
      getCensus().then((response) => {
        const prunData = getDataForForm(response);
        setData(prunData);
        setIsLoading(false);

        // Refresh storage
        latestCensusStore
          ?.clear()
          .then(() =>
            response.forEach((census) =>
              latestCensusStore
                ?.setItem(census.CensusId.toString(), census)
                .catch((error: any) => console.error(error))
            )
          )
          .catch((error: any) => console.error(error));
      });
    } else if (latestCensusStore) {
      // Get the latest census from local when offline
      getAllItems<Tree>(latestCensusStore).then((localCensus) =>
        setData(localCensus)
      );
    }
  }, [isOnline, latestCensusStore, setIsLoading, setData]);

  const updateData = (rowIndex: number, columnId: string, value: any) => {
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

    // This is the callback that will do pre-validation (easy stuff e.g. regex)
    const preValidationErrors = preValidate(rowIndex, columnId, value);
    if (preValidationErrors.size > 0) {
      validationErrors.addPreValidationErrors(
        rowIndex,
        columnId,
        preValidationErrors
      );
    } else {
      validationErrors.removePreValidationErrorsForCell(rowIndex, columnId);
    }
  };

  const applyPostValidation = () => {
    // HACK to get the cells to rerender
    // Why doesn't React count changes to an Object as a state change?!
    setHackyForceRerender(!hackyForceRerender);

    const postErrors = postValidate(data);
    validationErrors.setPostValidationErrors(postErrors);
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
            validationErrors={validationErrors}
          />
          <button
            type="submit"
            onClick={() => {
              applyPostValidation();
              if (validationErrors.size === 0) {
                // FIXME: revise this conditional to use ValidationErrorMap
                if (isOnline) {
                  // Submit to cloud when online
                  insertCensus(data).catch((error) => setErrors(error));
                } else {
                  // Save locally when offline
                  data.forEach((census) =>
                    userInputStore
                      ?.setItem(census.CensusId.toString(), census)
                      .catch((error: any) => console.error(error))
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

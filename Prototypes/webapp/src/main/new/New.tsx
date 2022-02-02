import { useState, useMemo, useEffect } from "react";
import { Shimmer, ShimmerElementType } from "@fluentui/react/lib/Shimmer";
import { Spinner, SpinnerSize } from "@fluentui/react/lib/Spinner";
import { PrimaryButton } from "@fluentui/react/lib/components/Button";
import { Stack } from "@fluentui/react/lib/Stack";

import { QuadratDataEntryForm } from "./QuadratDataEntryForm";
import { QuadratMetadataEntryForm } from "./QuadratMetadataEntryForm";
import { columns } from "./QuadratDataEntryForm/columnHeaders";
import { preValidate } from "../../validation/preValidation";
import { ValidationErrorMap } from "../../validation/validationError";

import { getCensus, insertCensus } from "./dataService";
import { Tree } from "../../types";
import { useStorageContext } from "../../context/storageContext";
import {
  useConnectivityContext,
  useConnectivityStateDispatch,
} from "../../context/connectivityContext";
import { getAllItems, getKey } from "../../helpers/storageHelper";
import { getDataForForm } from "../../helpers/formHelper";
import { useFormIsDirtyState } from "../../context/formContext";

export const New = () => {
  const { latestCensusStore, userInputStore } = useStorageContext();
  const { isOnline } = useConnectivityContext();
  const setIsOnline = useConnectivityStateDispatch();

  // when a form is dirty, it means the user has updated cell values
  const isDirty = useFormIsDirtyState();

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Table data has to be memoized for react-table performance
  const columnHeaders = useMemo(() => columns, []);
  const [validationErrors, setValidationErrors] = useState(
    new ValidationErrorMap()
  );
  const [hackyForceRerender, setHackyForceRerender] = useState(false);
  const [data, setData] = useState<Tree[]>([]);

  useEffect(() => {
    // If the form is dirty, skip updating the data of the form (online or offline).
    // This can avoid user input data got wipe out due to network instability.
    if (isOnline && !isDirty) {
      setIsLoading(true);
      getCensus(setIsOnline)
        .then((response) => {
          const prunData = getDataForForm(response);
          setData(prunData);
          setIsLoading(false);

          // Refresh storage
          latestCensusStore
            ?.clear()
            .then(() =>
              response.forEach((census) =>
                latestCensusStore
                  ?.setItem(getKey(census), census)
                  .catch((error: any) => console.error(error))
              )
            )
            .catch((error: any) => {
              console.error(error);
            });
        })
        .catch((error) => console.error(error));
    } else if (!isOnline && !isDirty && latestCensusStore) {
      // Get the latest census from local when offline
      getAllItems<Tree>(latestCensusStore).then((localCensus) => {
        const prunData = getDataForForm(localCensus);
        setData(prunData);
      });
    }
  }, [isOnline, isDirty, latestCensusStore, setIsLoading, setData]);

  const updateData = (
    rowIndex: number,
    columnId: string,
    tag: string,
    subquadrat: number,
    value: any
  ) => {
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
    const preValidationErrors = preValidate(
      rowIndex,
      columnId,
      tag,
      subquadrat,
      value
    );
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

  // FIXME: Post validation is removed for now because it conflicts with cloud validation.
  // const applyPostValidation = () => {
  //   // HACK to get the cells to rerender
  //   // Why doesn't React count changes to an Object as a state change?!
  //   setHackyForceRerender(!hackyForceRerender);
  //   const postErrors = postValidate(data);
  //   validationErrors.setPostValidationErrors(postErrors);
  // };

  const applyCloudValidation = (response: Tree[]) => {
    validationErrors.setCloudValidationErrors(response);
    console.log(validationErrors);

    // HACK to get the cells to rerender
    // Why doesn't React count changes to an Object as a state change?!
    setHackyForceRerender(!hackyForceRerender);
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
          <Stack
            horizontal
            verticalAlign="center"
            tokens={{
              childrenGap: 20,
            }}
          >
            <PrimaryButton
              text="Submit"
              type="submit"
              disabled={isSubmitting}
              onClick={() => {
                setIsSubmitting(true);

                // FIXME: Post validation is removed for now because it conflicts with cloud validation.
                // applyPostValidation();
                if (isOnline) {
                  // Submit to cloud when online
                  insertCensus(data, setIsOnline)
                    .then((response) => {
                      setIsSubmitting(false);
                      applyCloudValidation(response as Tree[]);
                    })
                    .catch((error) => {
                      setIsSubmitting(false);
                      console.error(error);
                    });
                } else {
                  // Save locally when offline
                  data.forEach((census) =>
                    userInputStore
                      ?.setItem(getKey(census), census)
                      .catch((error: any) => console.error(error))
                  );
                  setIsSubmitting(false);
                }
              }}
            />
            {isSubmitting ? <Spinner size={SpinnerSize.small} /> : undefined}
          </Stack>
        </>
      )}
    </>
  );
};

New.defaultName = "New";

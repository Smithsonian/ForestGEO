# Validations &amp; Statistics

A key part of this application is the **Validations** and **Statistics** resources!

The validation system is automatically incorporated into the measurements upload system, and will automatically trigger
as part of the upload process.

The post-validation statistics page is separately located, and requires manual triggering.

## The Validations System

As mentioned, the validations system is automatically incorporated into the measurements upload system. However, in
addition to this, there is a dedicated **Validations** navigation sublink that you can travel to in order to get a
better understanding of what each validation check means, and what its query looks like.

The following is a brief summation of the current validations and their default enabling status.

| Name                                                          | Description                                                                                                             | Default State |
|---------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|---------------|
| ValidateDBHGrowthExceedsMax                                   | For a given stem, flag all DBH measurements that show more than a 65 mm growth from the previous census.                | Enabled       |
| ValidateDBHShrinkageExceedsMax                                | For a given stem, flag all DBH measurements that show more than a 5% **decrease** from the previous census.             | Enabled       |
| ValidateFindAllInvalidSpeciesCodes                            | Flag all stems with a species code not already defined in the **species** table.                                        | Enabled       |
| ValidateFindDuplicatedQuadratsByName                          | Flag all quadrats within a plot that have the same name (quadrat names within a plot cannot overlap!).                  | Enabled       |
| ValidateFindDuplicateStemTreeTagCombinationsPerCensus         | Flag any tree/stem combinations that are recorded more than once in the same census.                                    | Enabled       |
| ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat | Flag any measurements whose dates are severely outside the established date range of the census, grouped by quadrat     | Enabled       |
| ValidateFindStemsInTreeWithDifferentSpecies                   | Flag any stems on the same tree with different species designations (each tree can only have one species!).             | Enabled       |
| ValidateFindStemsOutsidePlots                                 | Flag any stems whose calculated global location exceeds the bounds of the plot's global dimensions.                     | Enabled       |
| ValidateFindTreeStemsInDifferentQuadrats                      | Find any stems on the same tree with differing quadrat designations (all stems on a tree must be in the same quadrat!). | Enabled       |
| ValidateScreenMeasuredDiameterMinMax                          | Flag any DBH measurements exceeding species-defined minimum or maximum (if they are defined).                           | Enabled       |
| ValidateScreenStemsWithMeasurementsButDeadAttributes          | Flag any stems that have been assigned a `DEAD`-type attribute, but still have measurements recorded.                   | **Disabled**  |
| ValidateScreenStemsWithMissingMeasurementsButLiveAttributes   | Flag any stems that have **not** been assigned a `DEAD`-type attribute, but are still **missing** measurements          | **Disabled**  |

### Optional: Validation Queries

To directly view the queries composing the validations, use the dropdown button visible in the preview!

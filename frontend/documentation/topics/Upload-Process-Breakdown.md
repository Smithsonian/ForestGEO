# Upload Process Breakdown

The following is an outline of the upload cycle.

The core cycle remains the same between the data types in Stem & Plot Details menu, but there are some additional steps
incorporated into the measurements upload interface. The following is a breakdown of the process, in order:

### Important Notes about Uploading

Before you dive deeper into the upload cycle, there're some important points to note:

1. The upload cycle is **update-forward**. This means that the system will ALWAYS try to update data wherever it can
   instead of ignoring it outright. With this in mind, please **always try to re-upload data whenever possible!**
2. The upload cycle triggers **system updates** as part of its process. **Please ensure you don't navigate away from the
   page, reload it, or close it when uploading a file!**
3.

## Stage 1: Reviewing Headers & File Dropzone

Here is the first view you'll see after clicking on the Upload button:

!['upload_stage_1'](uploadstage1.png)

> If you click on the **Understanding the Headers** text, an accordion should dropdown, showing you
> the details of the headers required for the form type
> {style="note"}

### Example Headers View

Here's what the headers accordion will look like when uploading an `attributes` form:

![stemcodesheaders.png](stemcodesheaders.png)

## Stage 2: Uploading View

Next, you'll see a simple loading bar that shows the progress of the upload. Depending on the size of the file, you
might also see a distribution of the file into "chunks" that are then uploaded individually. This is done to ensure
that uploading is performed efficiently.

## Stage 3: File Backup to Azure

As part of the upload cycle, all uploaded files will **automatically** be backed up to the application's Azure Storage
account.

Please navigate to the **Recently Uploaded** page after your upload completes, and you should be able to see (and
download) your file there!

## Stage 4: Failed Row Processing:

After the upload completes, you'll be directed to this view:

![upload-complete-view.png](upload-complete-view.png)

### Understanding the Preprocessing View

This view is intended to provide you with a direct view of any rows that might have failed processing.

> This is **not** the same as a row with inaccurate or incorrect data!
>
> It only denotes rows that were **missing required fields** or that did not pass initial parsing in the first place.
> {style="warning"}

Because these rows did **not** pass pre-processing and were thus fully exempt from the upload, you can **download these
rows immediately** using the `Download All Rows as CSV` button. This will download the rows in a form-friendly format,
and will also include an additional column describing the pre-processing error encountered.

> Using this, you can then **immediately** re-upload the failed rows by editing them and removing the added Error
> Description column.

## Stage 5: System update & Upload Completion

After clicking the `Confirm` button as indicated in the upload completion screenshot, you will see a series of reload
progress bars appear and disappear in a rapid fashion. Finally, you will be directed to a final popup informing you that
**if you are uploading measurements**, failed measurements will be redirected to a dedicated table. Otherwise, they will
be discarded.

## Uploading Measurements

Uploading measurements to the system follow the same cycle as described earlier, but introduces some additional steps
and views. Here is an explanation of the additional steps you'll see and what they mean.

> As a reminder, remember that you can **only** upload measurements after you have added **some** data to each of the
> data types in the **Stem & Plot Details** menu!
> {style="warning"}

## Stage 1.5: Ingestion Processing

One of the core differences between uploading measurements and uploading the other data types is the **density** that a
measurement row contains.

As a quick review, the `measurements` data type specifies the following fields:

| field   | explanation                                                | source table                 |
| ------- | ---------------------------------------------------------- | ---------------------------- |
| tag     | the **tree's** tag (unique ID)                             | `trees`                      |
| stemtag | the **stem's** tag (unique ID)                             | `stems`                      |
| spcode  | the **species** code (unique ID)                           | `species`                    |
| quadrat | the name of the quadrat where the stem is located          | `quadrats`                   |
| lx      | the stem's **x-coordinate**                                | `stems`                      |
| ly      | the stem's **y-coordinate**                                | `stems`                      |
| dbh     | the stem's **diameter at breast height**                   | `coremeasurements`           |
| hom     | the **breast height** at which diameter was measured       | `coremeasurements`           |
| date    | the **date** when measurement was taken                    | `coremeasurements`           |
| codes   | a `;`-separated list of **attributes** describing the stem | `cmattributes`, `attributes` |

As you can see, there is a great deal more table interaction needed in order to ingest a single measurements row.
Because of this, the upload system breaks the upload down into **two steps** instead of the usual one for other data
types:

1. Direct upload to staging table
2. SQL ingestion process from staging table --> source tables

The secondary process here is the **ingestion process** - where SQL itself handles the ingestion and processing of the
rows found in the staging table. This step was added to increase the efficiency of the overall process.

## Stage 2.5: Data Validation

When you upload a measurements file, you will see an additional set of progress bars as the upload completes. These
progress bars denote the progress of the **data validation procedures** applied to the newly uploaded data.

Data validations are scheduled to occur immediately after data is fully ingested into your site's schema. This ensures
that any validation errors are immediately found.

The various validation sequences can be seen in more detail in the **Validations** page found in the **Census Hub**
page.

> If you have sufficient permissions, you should be able to **enable/disable** validations there, and further **edit**
> them if desired!

## Stage 4.5: Failed Row Processing

In addition to showing rows that were preemptively removed before the upload cycle, the failed measurements system will
**automatically** add any rows that fail during the upload cycle to a dedicated holding table (`failedmeasurements`) for
review.

> However, this will **not** be displayed within the failed row view shown during the upload cycle!

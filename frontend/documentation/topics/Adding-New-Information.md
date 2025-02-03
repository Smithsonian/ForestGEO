# Adding New Information

There are several different ways you can add data to a census! For ease of use and as an example,
we'll focus on the Stem Codes page's data view.

## Interacting with the Data View

The data view visible on the page mirrors how it is structured across all the other views in
the application. Each view shows a paginated (divided into pages) view of the data in the view's
respective table. There are several different ways you can interact with the view:

### Using the Toolbar

At the top of each data view, you should see a toolbar with a variety of options:

1. Filters
   1. Allows you to filter the view by placing constraints on the columns in the view.
   2. These filters will ONLY apply to the page you're currently viewing!
2. Density
   1. Allows you to change the height of the headers
3. Export
   1. Allows you to export the current page you're viewing
4. Add Row
   1. Allows you to add new rows. Please see below for more guidance on how exactly that works!
5. Refresh
   1. Reloads data from the table.
6. Export Full Data
   1. Exports all data in the table to JSON

> Row Actions:
>
> > (Note: this is dependent on whether the view is locked for editing)
> > {style='note'}
>
> > At the end of each row, you should see two buttons&mdash;a Pencil button and a Trash button.
> > This
> > will allow you to EDIT or DELETE a row from the view respectively.
>
> > If you click on the Pencil icon, the row will change to Edit mode. The icons will then
> > change to a Save button or a X-mark (Cancel) button. After you're done making your changes,
> > make sure to click on the Save button to trigger the save process!

### Adding New Rows

As mentioned earlier, there is a button in the toolbar called Add New Row. This will add in a
new row and **automatically move you to the last page**, creating another one if needed.

After the new row is added, the row will automatically change to Edit mode. You will then be
able to add your data &mdash; in this case, you'll be able to add a new Code, Description, and
then select a status.

### Saving your Changes

After you're done adding (or editing) your row, make sure you click on the Save button to
trigger the save process. This consists of two primary steps:

#### Re-Enter your Data

As part of the data submission process, you must re-enter the changes you were trying to make.
If you made changes to the Status (for this example) or a column consisting of a dropdown, you
must ensure you select the same change that you did at first.

#### Select your Change

After re-entering your data, you will be directed to a customized data view showing you:

1. The original row (no changes)
2. The first modification (the changes you made to the row before clicking on the Save button)
3. The second modification (the changes you submitted during data re-entry)

You must choose one of the three to save your changes. It's important that you check your work
and make sure you have the right information and are choosing the right option. Make sure that
you choose to either **cancel** or select the **original** row if both of your changes are
incorrect.

## Uploading New Data

In addition to allowing direct interaction with the data view, you can also choose to upload
data en masse by directly uploading a file (or form) of data.

> Your file must be EITHER comma-separated (.csv) or tab-separated (.txt) and also include headers!

### Accepted Form Types and Headers

There are five types of forms currently accepted, along with the headers that they accept:

| Form           | Headers                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `attributes`   | code, description, status                                                                        |
| `personnel`    | firstname, lastname, role                                                                        |
| `species`      | spcode, family, genus, species, subspecies, idlevel, authority, subspeciesauthority              |
| `quadrats`     | quadrat, startx, starty, coordinateunit, dimx, dimy, dimensionunit, area, areaunit, quadratshape |
| `measurements` | tag, stemtag, spcode, quadrat, lx, ly, coordinateunit, dbh, dbhunit, hom, homunit, date, codes   |

The Upload process consists of a several different stages:

#### Add Your File

The first stage is a two-parter: the first half of the screen (left side) is a large rectangular
box where you can drag and drop your file in or click to select a file. On the right side,
you'll see:

- A description of _what_ you're trying to upload, and a list of headers the file should have
  to be fully, properly uploaded.

> The headers (and respective columns) aren't required, but any data you've added in a column
> that doesn't have a header will be **discarded**!

- A description of your file, including its **name** and **size**.
- A **Delete Selected File** button to remove the file being described
- A **Review Files** button&mdash;to proceed to the next stage of the upload process

#### Review Your File

Once you move to the next stage, the file will be processed into a set of rows. The Review
process includes an option to remove the file being viewed, a description of the file, and a
view of the data in the file.

> Make sure you review your data before continuing! If you need to make changes or corrections
> to your file, click on the Re-Upload Corrected File button to re-upload the file!

Once you're satisfied with your changes, click on the **Confirm Changes** button continue to the
next stage.

#### Upload the File to the Server

The system will automatically attempt to upload your data to SQL. Once finished, a 5-second
countdown will trigger and automatically move you to the next stage, which will vary depending
on the type of file you're uploading.

#### (Measurements ONLY) Validate Data

If you are uploading a `measurements` file, the system will redirect you to a validation page,
where a series of checks will be performed. Measurements that fail the checks will be
highlighted in the data view after the upload process is complete, and measurements that pass
will be denoted by a green checkmark. The system will again trigger a 5-second countdown to
automatically progress to the next stage once all validations have run.

#### Upload the File to Azure Storage

The file will next be uploaded to Azure Storage, where it will be saved to a dedicated container
for the site/plot/census combination selected in the sidebar. After this is done, the system
will move you to the next and last stage.

If you're not uploading a `measurements` file, the system will automatically move you here.

#### Upload Completion

The final stage will trigger a series of server-side reloads on data views that will be affected
by the new data you've just uploaded. This will ensure that all data views are up-to-date.

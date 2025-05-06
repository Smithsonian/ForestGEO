# Understanding the Datagrids (Stem & Plot Details)

The datagrids are a key component of the app's user interface. They manage everything from data review to editing to insertion. 

## Stem Codes (Example)

The Stem Codes datagrid can be considered a "default" representation of the datagrid system. It should look something like this after you've added data to it:

![baseline stem codes](/images/stem-codes-base.png)

## Understanding the Headers

Similar to what's present in the upload cycle, there is an accordion dropdown presenting an explanation of the columns displayed in the datagrid:

![stem codes (understanding headers)](/images/stem-codes-understanding-headers.png)

> These headers are **not the same** as those present in the upload cycle/form requirements!
>
> Please keep that in mind when reviewing these headers.


## The Edit Toolbar

The following subsection of the datagrid:

![edit toolbar stem codes](/images/stem-codes-edit-toolbar.png)

is the Edit Toolbar. An iteration of this is present across **all** of the datagrids found in the application, but this can be considered the most baseline iteration. 

> All of the components present here will be present in all other datagrid implementations!
{style="warning"}

### Columns & Filtering

The columns and filtering buttons present on the left-hand side of the **Edit Toolbar** will allow you to customize the data view:

#### Column Dropdown:

The column dropdown is fairly straightforward, and will allow you to choose the columns being demonstrated:

![stem codes column dropdown](/images/stem-codes-column-dropdown.png)

> The columns selectable include **metadata columns**! They are not used elsewhere in the application, so please keep that in mind.

#### Filter Dropdown:

The filter dropdown presents specific, customization filtration system for you to narrow the data view shown. 

![stem codes filter dropdown](/images/stem-codes-filter-dropdown.png)

> each filter will only trigger after all **three** categories of the filter row are filled!

### Search All Fields & Refresh Button

The `Search All Fields` textbox is a **quick filter** alternative to the Filter dropdown!

Entering text here will search for your input across **all columns and all rows**! Due to its uncontrolled nature, this should be used mostly for speed and efficiency than exact narrowing. 

The `Refresh` button will trigger a **local** reload of the grid view. 

> This distinction is irrelevant until working with the View Data grid view. Please refer to it to take note of the difference between a `local` and `global` reload. 

### Data Import/Export

This next section of the Edit Toolbar allows for data entry and export. 

As mentioned in the upload cycle documentation, one of the main ways to input data into your site's database is by directly uploading a file. However, there is **another** way to add data:

#### The Manual Entry Form

The Manual Entry Form allows for bulk form input of data at once. Here is a baseline view of what the form will look like:

![stem codes manual entry form view](/images/stem-codes-mef.png)

> Please note the `Understanding the Headers` accordion present here as well! 

As you add each new row, ensure that you click on the **Save** button to save your changes!

The `Actions` tab will also hold actions you can take against individual rows. 

Once done, clicking the **Finalize Changes** button will submit your rows for ingestion into the database. After it completes, you should be able to see your changes present in the table. 

### Ancillary Actions

To the right of the Upload button will be a set of buttons triggering additional functions. This will change depending on the grid you're reviewing! At the very least, there should be **one** button present, using a `Hamburger` icon. This will toggle on/off any empty columns!

> Columns with **empty** data (no rows have data for that column) are automatically collapsed to make the other columns more visible.

#### Unique Ancillary Actions

The following is an outline of unique ancillary buttons present for each datagrid instance in the Stem & Plot Details submenu. 

Stem Codes:
- No ancillary buttons are present

Personnel:
- No ancillary buttons are present

Quadrats:
- No ancillary buttons are present

Species List:
- RESET Table: click this to reset the table entirely! 


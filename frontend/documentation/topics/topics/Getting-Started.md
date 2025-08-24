# Getting Started

Welcome to the ForestGEO Data Processing Application!

## About

The goal of this application is to allow you to record and analyze past and current census data for established global
sites worldwide. By either directly entering data or uploading CSV/TSV files (conforming to defined constraints), you
can save historical data and run validations or analysis on it as you complete a census.

### Summary of Operations

The app is intended to be used as follows:

1. You must be **assigned** as site by an administrator
2. You must **edit** or **request upload** of plots within that site.
3. Create a census through the dropdown
4. Populate your fixed data:
    - Stem Codes
    - Personnel
    - Quadrats
    - Species List
5. Once you've completed this, the **View Data** link should become available to use
6. Upload or Enter **measurements** information within the **View Data** page
7. Validate and edit (if needed) your measurements information
    - If you **upload** measurements, they will automatically be validated!
8. Once you've entered measurements, the **Post-Census Statistics** link should become available to use
9. Use this to perform **analyses** on your data to derive conclusions on your census
10. If you have permissions, use the **Validations** page to enable, disable, or edit validations

## Logging In

Before you can log in, you must complete the following (if you haven't already):

- You must create a **personal** Microsoft (non-SI) account (if you don't have one already)
- An administrator must invite you to the Smithsonian Research Computing tenant.
- From here, your account will be added to the ForestGEO app server
- An administrator must assign at least one site to you

Once these steps are finished, you should be able to login to the application and successfully use the site.

> Currently, this is a stopgap measure. We are working on a solution to allow for ForestGEO users to log in with their
> SI credentials.

### Logging Into the Website

In order to log into the website proper, please navigate to the **production** website instance, available
at [](https://forestgeo-livesite.azurewebsites.net).

Click on the icon: ![login icon view](mui-login-icon.svg) to log in!

## Submitting Help Tickets

In the event that you run into issues of any kind, please submit a **help ticket** by clicking on the `question mark`
icon in the bottom right of the screen!

![highlighted GitHub feedback button](github-feedback-button.jpg)

Clicking on this button will open a form allowing you to explain the issue you're encountering!

![GitHub feedback form](github-feedback-form.png)

> Completing this will create a GitHub Issue ticket for further review!
> {style="note"}

### Customizing Your Plot

After you log in, you'll be redirected to the dashboard. A sidebar on the left side of the window should appear, with
dropdowns to select a **Site**. It should look something like this:
![site-dropdown.png](site-dropdown.png){ style="inline"}

Once you've selected a site, you'll be able to select a **Plot**, looking something like this:
![plot-dropdown.png](plot-dropdown.png) {style="inline"}

> Please note - the plot you'll first see is a **placeholder**! Please use the ellipsis button to open the customization
> popup:

![plot-edit-button.png](plot-edit-button.png){ style="inline"}

#### Plot Customization Popup

![plot-custom.png](plot-custom.png)

Use this to customize your plot! After saving, your selections will reset and the site will update itself. Please ensure
your edits are visible when you attempt to select the plot again!

### Creating a Census

This app operates along the following **core concepts**:

1. **Site**: A site is a collection of plots.
2. **Plot**: A plot is a geographic region marked for data collection
3. **Census**: A census is a **date range** denoting a distinct time period where data was collected in the **Plot**

With this in mind, you will need to create a census before you can begin entering data. After opening the Census
dropdown, click on the Add New Census button to open the Census Creation/Rollover popup:

![add-new-census.png](add-new-census.png) {style="inline"}

#### Census Creation/Rollover Popup

![rollover-modal.png](rollover-modal.png)

This popup allows you to create a new census and further offers some additional options to simplify the new census
creation process. If you're creating a new census, but it **isn't the first census**, then you can use the Rollover
dropdowns for each of the core data types to automatically copy over data from a previous census that hasn't changed.

> When creating a new (**first**) census, please select `Confirm No Rollover` for each of the data types before clicking
> the Confirm button.

You must **either** confirm no roll over **or** select a prior census to choose from for each of the main data types.
Additionally, you can further customize the number of rows from the selected census to roll over by pressing the
Customize button. This will open a grid display allowing you to select/deselect rows.

Creating a new census will also trigger a selection reset. Please re-select your prior selections, and you should be
able to see your new census displayed.

#### Understand the Data Types

There are **four** core data types that are required before you can record measurements for a census.

> **Fixed Data is not census-dependent!**
> {style='warning'}

They are:

- **Stem Codes**: A list of shorthand codes designating attributes that can assigned to a tree/stem object.
- **Personnel**: A list of personnel working on the census. Additionally, you can add/designate roles to each user to
  better denote how personnel are distributed job-wise across the census.
- **Quadrats**: A breakdown of the plot into smaller area segments.
- **Species**: A list of species found in the plot. Each species is assigned a shorthand **Species Code** to allow rapid
  assignment when actively recording statistics in the field.

#### Deleting a Census?

If your permissions allow it, you may be able to highlight and click on a **Trashcan** icon along the **latest** census.
Clicking on this will delete the census in question.

> You won't be able to delete a census if it's NOT the latest census!

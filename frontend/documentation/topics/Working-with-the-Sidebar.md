# Working with the Sidebar

## Making Selections

### Selecting a Site

In the sidebar, you'll see a single selection menu that says _Select a Site_. This is the first step needed to reach the
data management part of the application.

> Selecting a site will determine which schema in the data server you are connected to, so having a site assigned to
> your account in the data server's core database is critical!

When reviewing the contents of the dropdown, you should see Schema Names associated with each site. This is intended
for additional clarity so that in the event that you know what schema you need to connect to but not which site, you
can still find it.

### Selecting a Plot

After selecting a site, an additional dropdown should slide downwards from the site selection box, allowing you to
select a Plot.

> A plot describes a subsection of a site, and includes properties like dimensions, coordinates, and other statistical
> information.

When choosing a plot, you should also see how many quadrats are associated with that plot!

### Selecting a Census

After you choose a Plot, a third dropdown should appear, allowing you to select a Census. In addition, a navigation
menu should also become visible. However, until you select a Census, this menu will be **disabled**.

> A census describes a single period of time when data was collected and reviewed as part of a single whole.

It's not a fixed period, and is instead described and determined by the first and last measurement recorded as part of
that census. When you open the dropdown, you should see a First and Last Measurements display as part of each
selectable census. If there aren't any measurements associated with the census, it should say No Measurements.

> The First and Last Measurements display will change as you upload measurements. These boundaries simply highlight
> the outer edges of when measurements were recorded, and should not be considered hard and fast limits.

Once you select a census, the navigation menu should become enabled and interactible!

#### Creating a New Census and Using the Rollover Modal

As you interact with the Census dropdown, you should see a small plus icon in the top right corner of the dropdown
that says **Add New Census**. This will trigger a new modal that will provide a series of options before you create
a new census.

The Rollover Modal will then appear, providing you with two options:

1. Rolling over personnel information
2. Rolling over quadrats information

Personnel and Quadrats information are census-dependent:

In the event that you have some of the same people working on a new census that were working on one before, or if you
have some quadrats that have not changed (coordinates, dimensions, etc.), **you will need to re-add them to the new
census**.

The Rollover modal is intended to simplify this process. If you open the dropdown for either Personnel or Quadrats,
you should be able to see past censuses and whether they have respective information that can be rolled over into
the new census you're making.

> If a census doesn't have that information (Personnel for the Personnel rollover, Quadrats for the Quadrats
> rollover), you won't be able to select it!

If you don't want to roll over ANY information into your new census, click the confirmation button for either case.
You aren't required to roll over existing data into a new census, but it's important to note that you won't be able
to roll over data later.

> The Rollover modal only applies to data that is census-dependent! Data that isn't (i.e., stem codes or species
> information) will automatically be rolled over by default!
> {style="note"}

If you decide to roll over existing information, simply select the census you want to roll over data from.

The system will automatically attempt to roll over all existing (personnel or quadrats) information from the
selected census. However, if you want to only move over partial information, click on the Customize Selections
button! This will open a table with checkboxes that will allow you to specify which quadrats or personnel you want
to roll over.

## Understanding the Navigation Menu

The navigation menu is a quick and easy way to navigate around the site!

### Dashboard

The Dashboard page is the home page you're redirected to when you first log into the app. Please see the [Dashboard]
(Understanding-the-Dashboard.md) page for more information on what's displayed in the Dashboard itself!

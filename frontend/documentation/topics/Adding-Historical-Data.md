# Adding Historical Data

The first thing you'll have to do when logging into the app for the first time is to add historical data.

## Understanding the Forms

The app is designed to accept file uploads (called `forms`) in either CSV or TSV format.

A "complete" census comprises the following data types (forms):

- attributes
- personnel
- quadrats
- species
- measurements - **this will be locked until at least one of each of the other data types has been added!**

Each form accepts a set of headers. Some headers are required, and some are optional. Please ensure you have (at
minimum) the required headers when uploading a file.

> Files that do not contain the required headers will be rejected!
> {style="warning"}

### The `attributes` Form

The `attributes` form accepts the following headers:

- `code` (required): a string composed of 10 or less characters that describes an **attribute** or **property** of a
  stem
- `description`: a description of the attribute or property
- `status`: a classification of the attribute as one of the following (`alive`, `alive-not measured`, `dead`, `missing`,
  `broken below`, `missing`)

You can upload `attributes` forms by navigating to the Stem & Plot Details > Stem Codes page. Locate the upload file
button and follow the instructions in the popup that will appear to complete your upload.

### The `personnel` Form

The `personnel` form accepts the following headers:

- `firstname` (required)
- `lastname` (required)
- `role` (required): a (very) brief description of the task the personnel was responsible for during the census
- `roledescription`: A more detailed explanation of the role assigned

You can upload `personnel` forms by navigating to the Stem & Plot Details > Personnel page and clicking on the Upload
File icon button.

### The `quadrats` Form

The `quadrats` form accepts the following headers:

- `quadrat` (required): the unique identifier (text) assigned to the quadrat
- `startx` (required): the starting x-coordinate of the quadrat
- `starty` (required): the starting y-coordinate of the quadrat
- `dimensionx` (required): the width of the quadrat along the x-axis
- `dimensiony` (required): the width of the quadrat along the y-axis
- `area`
- `quadratshape`: a description of the overall shape of the quadrat

You can upload `quadrats` forms by navigating to the Stem & Plot Details > Quadrats page and clicking on the Upload File
icon button.

### The `species` Form

The `species` form accepts the following headers:

- `spcode` (required): a shorthand (unique) code used to identify the species
- `family`: the family taxonomy of the species
- `genus`: the genus taxonomy of the species
- `species` (required): the name of the species
- `subspecies`: the subspecies taxonomy of the species
- `idlevel`: the deepest taxonomic level of identification of the species (e.g. `species`)
- `authority`: taxonomic authority for the species
- `subspeciesauthority`: taxonomic authority for the subspecies

You can upload `species` forms by navigating to the Stem & Plot Details > Species List page and clicking on the Upload
File icon button.

---

### The `measurements` Form

The `measurements` form accepts the following headers:

- `tag` (required): the unique identifier assigned to the **tree**
- `stemtag`: the unique identifier assigned to the **stem**
- `spcode`: the shorthand code assigned to the stem's species
- `quadrat`: the unique identifier assigned to the quadrat where the stem was located
- `lx` (required): the x-coordinate of the stem **within the quadrat**
- `ly` (required): the y-coordinate of the stem **within the quadrat**
- `dbh`: the diameter of the stem at breast height
- `hom`: the height at which the DBH was recorded
- `date` (required): the date when the stem was measured
- `codes`: a comma-separated list of attribute codes assigned to the stem

You can upload `measurements` forms by navigating to the Stem & Plot Details > View Data page and clicking on the Upload
File icon button.

The measurements upload process will kick off a series of additional procedures that will be outlined later on.

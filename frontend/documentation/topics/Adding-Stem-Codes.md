# Adding Stem Codes

There are two ways you can add stem codes to a census:

1. If you click on the **Other** button → Multiline Upload Form, a form popup will appear

The CTFSWeb Handbook contains detailed instructions on how stem codes need to be formatted
before they can be submitted to the website.
I've copied relevant information here and tweaked it to fit the new form structures used in the
website!

### Important Note

> All data files should be tab-delimited text files with a header using the column names outlined
> below.
> Avoid special characters and quotes (single or double).
> You can create them in a spreadsheet and save as tab-delimited or comma-delimited files.

Tree Measurement Codes (codes.txt)
These are the codes used by field personnel to describe the condition of a tree, stem or
measurement. These codes are locally derived and can be in any language. These tree
measurement codes will eventually be inserted into the TSMAttributes table, which is a permanent
table.

- code: one or more letters that describe or explain the condition of a tree, stem, or measurement
  (e.g. “L”)
- description: a free text description of the code (e.g. “leaning”)
- status: one of six standardized terms used as a summary category for the code and the
  condition of the stem which it describes:
  a. alive: the stem is alive
  b. alive-not measured: the stem is alive but was not measured
  c. dead: the ENTIRE TREE is dead
  d. missing: field crews missed this stem, and it was not measured during the census
  e. broken below: the stem was previously ≥ 1 cm dbh, but in this census was found alive
  but broken off, now with a dbh <1 cm
  f. stem dead: the stem is dead and/or not found

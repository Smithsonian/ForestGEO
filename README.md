# ForestGEO App

A web application to help a global network of scientists at the Smithsonian Institution's Forest Global Earth Observatory (ForestGEO) manage forest diversity data, pertinent to the study of our rapidly changing climate. ForestGEO App uses React.js on the front end and Azure Functions and Cosmos DB on the back end to validate, standardize, and warehouse data from 70+ research sites.

Every five years a site conducts a tree core census where every "free-standing woody stem >1cm DBH \[diameter at breast height, 1.3m\] is identified to species, mapped, and tagged when it first enters the census within a plot" ([ForestGEO](https://forestgeo.si.edu/protocols/forest-census)). Following field data collection and entry, ForestGEO App parses user-uploaded CSV files, validates them against pre-defined parameters and past census data, and returns a detailed error report which specifies error location and type, so that researchers can easily make corrections.

See our [technical specification](https://github.com/ForestGeoHack/ForestGEO/wiki/ForestGEO-App-Specification) to learn more.

# Lo-fi UI Mockups

**Figure 1.1** Drop box for CSV files containing census data that is either new or revised.
![Desktop - 1](https://user-images.githubusercontent.com/43100092/169610973-abeb7f02-18c6-4b4f-a764-9f972433cabc.jpg)

**Figure 1.2** CSV-uploaded census data displayed with inline error messages, for print or download.

![Desktop - 3](https://user-images.githubusercontent.com/43100092/169610999-bf7be3d1-3a7d-45ef-bdee-371a54d343a0.jpg)

**Figure 1.3** Previously uploaded file list, with indication of validation status and ability to edit or delete files.

![Desktop - 4](https://user-images.githubusercontent.com/43100092/169611038-1e8c8150-ef0d-4a91-8408-50bed59970fd.jpg)

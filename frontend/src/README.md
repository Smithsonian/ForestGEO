# ForestGEO App

A web application to help a global network of scientists at the Smithsonian Institution's Forest Global Earth Observatory (ForestGEO) manage forest diversity data, pertinent to the study of our rapidly changing climate. ForestGEO App uses React.js on the front end and Azure Functions and Cosmos DB on the backend to validate, standardize, and warehouse data from 70+ research sites.

Every five years a site conducts a tree core census where every "free-standing woody stem >1cm DBH \[diameter at breast height, 1.3m\] is identified to species, mapped, and tagged when it first enters the census within a plot" ([ForestGEO](https://forestgeo.si.edu/protocols/forest-census)). Following field data collection and entry, ForestGEO App parses user-uploaded .csv files, validates them against pre-defined parameters and past census data, and returns a detailed error report which specifies error location and type, so that researchers can easily make corrections.

See our [technical specification](https://github.com/ForestGeoHack/ForestGEO/wiki/ForestGEO-App-Specification) to learn more.

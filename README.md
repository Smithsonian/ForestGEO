# The ForestGEO Data Entry App

A cloud-native web application built to accelerate the pace of research for the Smithsonian 
Institution's Forest Global Earth Observatory (ForestGEO). ForestGEO is a global forest research 
network, unparalleled in size and scope, comprised of ecologists and research sites dedicated to 
advancing long-term study of the world's forests. The ForestGEO app aims to empower researchers with
an efficient means of recording, validating, and publishing forest health data.

This application was built using Next.js 13 (app directory) and NextUI (v2).

### Technical documentation:
Please see the documentation [here](https://github.com/ForestGeoHack/ForestGEO/wiki/ForestGEO-App-Specification)

## Project Structure
- `prev_app/`: previous iteration of the ForestGEO app, which uses the  
  Next.js v12 Pages router system. You can step into this directory to run the previous iteration 
  of the application
- `app/`: the primary routing structure and setup for the primary application
- `components/`: requisite react components that are used within the 
  application and icon information
- `config/`: fonts information and general site information -- endpoint names, plot names, plot 
  interface, etc.
- `styles/`: tailwindcss formatting files and dropzone/validation table custom formatting files
- `types/`: additional set up for SVG formatting

---
### Understanding Next.JS Dynamic Routing
Next.js's dynamic routing setup allows for built-in endpoint data processing. By using this, 
passing data from a component or root layout to a page/endpoint is simplified (rather than using 
useCallback or a React function). As a brief reminder, remember that when using 
Next.js 13, writing something like `app/example/page.tsx` will generate a route pointing to `...
/example` instead of `.../example/page`, and nesting successive folders will create a route with 
those folders: `app/example1/example2/example3/page.tsx` has the route `...
/example1/example2/example3/`. 

For a better explanation of how this works, please observe the 
browse endpoint: `app/(endpoints)/browse/[plotKey]/[plotNum]/page.tsx`<br />
In order from left to right, please note the following points of interest:
- `(endpoints)`: wrapping a folder in parentheses allows for better organization w/o using the 
  wrapped folder name in the path. For example, accessing the Browse page locally does not 
  require adding `/endpoints/` to the URL
- `[plotKey]`: this is the first required variable when accessing this endpoint -- you 
  will have to add some string `plotKey` to the end of the URL: `.../browse/[your plot key]` in 
  order to successfully view the page.
  - wrapping a folder in `[]` will designate that folder as a **required** dynamic parameter
  - wrapping in `[...folderName]` designates `folderName` as a catch-all route. All 
    following values after `folderName` (i.e., `.../a/b` will return `folderName = [a, b]` )
  - wrapping in `[[...folderName]]` designates `folderName` as an *optional* catch-all route. As 
    expected, all values for/after `folderName` will be returned as part of the dynamic route, 
    but `undefined` will also be returned if no value is entered at all (instead of a 404 error)
- `[plotNum]`: second required variable when accessing this endpoint - your resulting endpoint 
  will look like (example) `http://localhost:3000/browse/plotKey/plotNum`. 
---

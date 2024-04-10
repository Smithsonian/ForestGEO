# Changelog

## New Features

- **Generic MUI X DataGrid Component:** Centralized in the components directory for initializing different fixed data endpoints, simplifying CRUD logic.
- **CRUD API Endpoints:** Fully implemented for each fixed data endpoint.
- **Server-Side Pagination:** Updated for datagrid view and API endpoints, enhancing loading speeds by not loading full datasets at once.
- **Context/Reducer System:** Fully integrated into the app's lifecycle. Saves users' selections and propagates changes throughout the application. Includes:
  - User selections like plot, census, quadrat, and site.
  - List selection and core data retrieval/storage for certain data types.
  - A universal loading context with a fullscreen disable, progress component, and custom message.
- **Login System Reorganization:** Improved user experience by removing the repetitive EntryModal component.
- **File Upload System:** Fully implemented with several phases including Upload Start, Upload Parse, Upload Review, Upload Fire (SQL), Upload Validation, Upload Update Validation, and Upload Fire (Azure).
- **Catalog Database Implementation and Integration:** For multi-tenant database structuring with users, sites, and plots identification.
- **Site Selection Implementation:** Allows dynamic site loading and data separation.
- **Azure Web Application Connection:** With reduced build and deployment times.
- **Schema Changes:** Updated core schema setup.
- **Database Connection System Updates:** Incorporates a PoolMonitor class wrapper for better management and logging.

## Enhancements

- **Contextual System Expansion:** To handle more user selections and data types.
- **Generic, Type-Agnostic Reducer Functions:** Enhanced dispatch systems in contexts.
- **User-Friendly Core Measurements View:** Updated to use a dedicated view.
- **Autocomplete Components:** Customized for manual input and other application parts.

## Fixes

- **Database Connection Monitoring:** Improved with a new wrapper and a shell script for consistent monitoring.
- **Session Resume Dialog:** Added in the sidebar for convenient session resumption or restart.
- **Validation System Improvements:** Including refinement of procedures and error handling.
- **Load Handling Enhancements:** For better user experience during data retrieval and dispatch.

## Future Updates

- **Manual Input Census Form Completion:** Slated for the next round of core updates.
- **Further Refinements in Validation and Site Selection Systems:** To enhance user experience and application reliability.

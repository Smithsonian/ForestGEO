# Getting Started with the web app

## About the app
This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

It is a Progressive Web App (PWA) to support offline mode.

A web worker is registered to upload user input data while app is online.

For offline storage, we use [localForage](https://github.com/localForage/localForage) for [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).


## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

Note: Service worker offline scenario cannot be tested in hot-reload mode. Please generate production build (`npm run build`) then run  `serve -s build`.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

You can leverage serve to serving the production build from local machine.
To install serve, run `npm install -g serve`
After the product build succeed, run
`serve -s build`

## Deployment
This project isn't enabled CI/CD. Depolyment is done manually by uploading production build files into web server.
To be able to register service worker for PWA, the web server has to enabled HTTPS if the domain is not localhost.

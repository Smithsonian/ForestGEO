# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm run prepare`

Set up the project with the pre commit hook so your code is formatted automatically.

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run format`

Format the code with "prettier".

### `npm run lint`

Run the linter to find errors.

### `npm run lint-fix`

Try and fix errors automatically.

### `npm run tsc`

Run the TypeScript type checker.

### `npm run storybook`

View a demo of components ("storybook") in the browser.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### How to use Storybook? What is storybook?

Storybook is a demo of our components. 
It's useful for development and testing variations of our components.
We can _create variations_ of each component by using **stories**,
an example of a variation is a blue button or a red button.

To see the storybook running run this:

```bash
npm run storybook
```

... which opens the browser on port 6006 and allows you to see all components with stories.

See [official tutorial](https://storybook.js.org/tutorials/intro-to-storybook/react/en/simple-component/) to create new components.

See src/components/DropZone/DropZone.stories.tsx and other .stories.tsx files as examples.

Each Component.tsx should have a Component.stories.tsx next to it.

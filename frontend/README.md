# ForestGEO Census Management Application

A cloud-native web application built to accelerate the pace of research for the Smithsonian
Institution's Forest Global Earth Observatory (ForestGEO). ForestGEO is a global forest research
network, unparalleled in size and scope, comprised of ecologists and research sites dedicated to
advancing long-term study of the world's forests. The ForestGEO app aims to empower researchers with
an efficient means of recording, validating, and publishing forest health data.  
Learn more about ForestGEO [at their website](https://forestgeo.si.edu/).

## Setting up for Local Development

This project uses NextJS v14(+), and server interactions and setup are handled through their interface. Please note
that for local development, you will **not** be able to use the NextJS-provided `next start` command due to the way that
the application is packaged for Azure deployment. Instead, please use the `next dev` command to start the local
development server to use the application.

> Note: the development server compiles and loads the application in real time as you interact with the website.
> Accordingly, **load times for API endpoints and other components will be much longer than the actual site's.** Please
> do not use these load times as an indicator of load times within the deployed application instance!

### Production vs Development Branches

The `main` branch of this repository is the production branch, and the `forestgeo-app-development` is the deployed
development branch. When adding new features or making changes to the application, please branch off of the
`forestgeo-app-development` branch instead of `main`. The production branch should not be used as a baseline and should
only be modified via approved PRs.

### Azure-side Setup Requirements

The application maintains a live connection to an Azure Storage and a Azure MySQL server instance. Before you can use
the application, please ensure that you work with a ForestGEO administrator to:

1. add your email address to the managing database,
2. provide you with a role and,
3. assign the testing schemas to your account

> It is critical that live sites actively being used by researchers are not mistakenly modified or damaged!

### Setting up the Environment

> **Note:** The following instructions assume that you have `NodeJS` and `npm` installed on your local machine.

After cloning the repository, please run `npm install` to install required dependencies.

The application requires a set of environmental variables stored in a `.env.local` file in order to run locally. Please
contact a repository administrator to request access to the key-vault storage, named `forestgeo-app-key-vault`. Once you
can access it, please retrieve all noted secrets in the repository and place them in your `.env.local` file. The name of
the secret corresponds to the name of the environmental variable. Please use the following example as a template:

Let's assume that the keyvault storage has a secret named `EXAMPLE-SECRET`, with a corresponding value of `1234`.
In order to use this secret in your local environment, add it to your `.env.local` file like this:

`EXAMPLE_SECRET=1234`

Please note that the name of the secret in the keyvault uses **hyphens**, while the name of the environmental variable
uses **underscores**. Please ensure you **replace all hyphens with underscores** when adding the secret to your
`.env.local` file.

Once you have successfully created your `.env.local` file, please run `npm run dev` to start the local development
server.

> **Ensure that you have port 3000 open and available on your local machine before starting the server!**

## Azure Static Web Apps service

The project test app is currently deployed using Azure Static Web Apps service and can be accessed
at

https://agreeable-wave-08a957210.1.azurestaticapps.net/

When we get an update on subscription we can use, the URL will be changed. During the deployment
process Azure automatically creates GitHub workflow file that defines CI/CD (Continuous
integration/deployment). For example, when the code is updated and PR is created, GitHub
automatically creates a copy of the app with the updated code and provides URL for that so it is
easy to test the changes and compare updated app with the one in production.

### **Useful links:**

[Static Web Apps](https://azure.microsoft.com/en-us/services/app-service/static/#overview)  
[Quickstart: Building your first static site with Azure Static Web Apps](https://docs.microsoft.com/en-us/azure/static-web-apps/getting-started?tabs=vanilla-javascript)

### **Brief Instruction**

To deploy an app Azure subscription is required (free limited student subscription
available - https://azure.microsoft.com/en-us/free/students/)  
In the main dashboard search for Static Web Apps resource, click +Create and fill all necessary
information, including GitHub repository, branch and choose correct build preset (React Framework
for ForestGEO project).  
**Important:** you need to be a repository owner or an administrator to deploy it. The easiest way
to test the service is to fork a repository and deploy it.

### Instruction for local development

(based on https://docs.microsoft.com/en-us/azure/static-web-apps/local-development)

1. Install necessary packages in Api and FrontEnd folders (e.g. cd /Api && npm install)
2. Install static-web-apps-cli in the FrontEnd folder (cd /FrontEnd && npm install
   @azure/static-web-apps-cli)
3. Go to Api folder and execute 'npm run watch' command
4. In the new terminal execute 'swa start' command
5. Server should be up and running at http://localhost:4280 

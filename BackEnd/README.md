## Azure Static Web Apps service
The project test app is currently deployed using Azure Static Web Apps service
and can be accessed at https://black-flower-0ae66d51e.1.azurestaticapps.net/  
When we get an update on subscription we can use, the URL will be changed.
During the deployment process Azure automatically creates GitHub workflow file that defines CI/CD (Continuous integration/deployment). For example, when the code is updated and PR is created, GitHub automatically creates a copy of the app with the updated code and provides URL for that so it is easy to test the changes and compare updated app with the one in production.
  
### **Useful links:**  
[Static Web Apps](https://azure.microsoft.com/en-us/services/app-service/static/#overview)  
[Quickstart: Building your first static site with Azure Static Web Apps](https://docs.microsoft.com/en-us/azure/static-web-apps/getting-started?tabs=vanilla-javascript)

### **Brief Instruction**
To deploy an app Azure subscription is required (free limited student subscription available - https://azure.microsoft.com/en-us/free/students/)  
In the main dashboard search for Static Web Apps resource, click +Create and fill all necessary information, including GitHub repository, branch
and choose correct build preset (React Framework for ForestGEO project).  
**Important:** you need to be a repository owner or an administrator to deploy it. The easiest way to test the service is to fork a repository and deploy it.


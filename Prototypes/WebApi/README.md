# Forest GEO Data API

This is the data API written in Azure Functions. It interfaces with the backend data provider (Comsos DB) and performs cloud validations.

## Deployment Instructions

1. Clone the repo and open `WebApi.csproj`
1. In visual studio, right click on `WebApi` functions project and click `Publish...`
2. Create a new publishing profile and select your destination function app. It will need to be a .NET 3.1 app running on consumption windows.
3. At the top of the page, click `Publish`
4. Open the resource in Azure, select `Configure` and add the following app settings:
    | App Setting Name | App Setting Value|
    |------------------|------------------|
    |`CosmosEndpointUri`|[Replace with your cosmos endpoint uri]|
    |`CosmosPrimaryKey`|[Replace with your cosmos primary key]|
    |`CosmosDatabaseId`|`forestgeo`|
    |`CosmosContainerId`|`TreeMeasures`|

## Local Running Instructions

The solution should run locally out of the box, so long as it is connected to a local Cosmos DB simulator or Azure Cosmos DB endpoint.

Your local.setting.json must contain either your local or remote connection information as follows

```JSON
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet",
    "CosmosEndpointUri": "[Replace with your cosmos endpoint uri]",
    "CosmosPrimaryKey": "[Replace with your cosmos primary key]",
    "CosmosDatabaseId": "forestgeo",
    "CosmosContainerId": "TreeMeasures"
  }
}
```
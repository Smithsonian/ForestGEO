using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Microsoft.Azure.Cosmos;
using ForestGEO.WebApi.Model.Contracts;
using System.Collections.Generic;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public static class TreeTriggers
    {
        private static readonly string EndpointUri = System.Environment.GetEnvironmentVariable("CosmosEndpointUri", EnvironmentVariableTarget.Process);
        private static readonly string PrimaryKey = System.Environment.GetEnvironmentVariable("CosmosPrimaryKey", EnvironmentVariableTarget.Process);
        private static string databaseId = System.Environment.GetEnvironmentVariable("CosmosDatabaseId", EnvironmentVariableTarget.Process);
        private static string containerId = System.Environment.GetEnvironmentVariable("CosmosContainerId", EnvironmentVariableTarget.Process);

        private static CosmosClient cosmosClient = new CosmosClient(EndpointUri, PrimaryKey);
        private static readonly Database database = TreeTriggers.cosmosClient.GetDatabase(TreeTriggers.databaseId);
        private static readonly Container container = TreeTriggers.database.GetContainer(TreeTriggers.containerId);

        [FunctionName("GetCensus")]
        public static async Task<IActionResult> GetCensus(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "Census")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            var sqlQueryText = "SELECT * FROM c";

            List<Model.Contracts.Tree> trees = await CosmosController.QueryCosmos(sqlQueryText, TreeTriggers.container);

            return new OkObjectResult(JsonConvert.SerializeObject(trees));
        }
        [FunctionName("PostCensus")]
        public static async Task<IActionResult> PostCensus(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "Census")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");
            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<ForestGEO.WebApi.Model.Contracts.Tree[]>(requestBody);

            if(data != null && data.Length > 0)
            {
                return new OkObjectResult(JsonConvert.SerializeObject(data));
            }
            else
            {
                return new BadRequestObjectResult("Unable to parse input");
            }
            
        }
    }
}

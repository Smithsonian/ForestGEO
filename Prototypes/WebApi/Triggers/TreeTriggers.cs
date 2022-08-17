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
using System.Collections.Generic;
using ForestGEO.WebApi.Model.Utilities;

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
            log.LogInformation("C# HTTP trigger function processed a get census request.");

            //The census Id and plot Id are hardcoded for the hackathon demo. These should be query paramaters in a future update.
            List<Model.Contracts.Tree> trees = await CosmosController.QueryCosmos(
                TreeUtilities.TreeSQLQuery(
                    plotId: 1,
                    censusId: 2), 
                TreeTriggers.container);

            return new OkObjectResult(JsonConvert.SerializeObject(trees));
        }
        [FunctionName("PostCensus")]
        public static async Task<IActionResult> PostCensus(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "Census")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a post census request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var currentCensus = JsonConvert.DeserializeObject<Model.Contracts.Tree[]>(requestBody);

            if(currentCensus == null || currentCensus.Length == 0)
            {
                return new BadRequestObjectResult("Unable to parse input");
            }

            //The census Id and plot Id are hardcoded for the hackathon demo. These should be query paramaters in a future update.
            //For the prior census we will need logic to look up the most recent finalized census.
            var priorCensus = await CosmosController.QueryCosmosToDictionary(
                TreeUtilities.TreeSQLQuery(
                    plotId: 1,
                    censusId: 2),
                TreeTriggers.container);
            
            //TODO: Push updated data for the current census to Cosmos

            return new OkObjectResult(
                JsonConvert.SerializeObject(
                    TreeUtilities.CheckDeadTrees(currentCensus,priorCensus)));
        }
    }
}

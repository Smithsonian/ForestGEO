using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public static class TreeTriggers
    {
        [FunctionName("GetCensus")]
        public static IActionResult GetCensus(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "Census")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            return new OkObjectResult(JsonConvert.SerializeObject(MockData.TreeData));
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

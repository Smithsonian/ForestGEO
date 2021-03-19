using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using ForestGEO.WebApi.Model.Storage;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public static class ProcessTrees
    {
        private static MySqlClient mySql = new MySqlClient();

        [FunctionName("GetTrees")]
        public static IActionResult GetTrees(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            Dictionary<(string,string),ForestGEO.WebApi.Model.Storage.TreeStorage> LoadingResponse = mySql.QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");
            return new OkObjectResult(JsonConvert.SerializeObject(LoadingResponse.Values));
        }

        [FunctionName("PostTrees")] 
        public static async Task<IActionResult> PostTrees(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<Tree[]>(requestBody);

            Dictionary<(string,string),ForestGEO.WebApi.Model.Storage.TreeStorage> TreeRecords = mySql.QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");

            var ResponseBuilder = new ArrayList();
            foreach(var Tree in data){
                if(TreeRecords.ContainsKey((Tree.Tag, Tree.StemTag)) && 
                    Tree.IsAlive() && TreeRecords[(Tree.Tag, Tree.StemTag)].IsDead())
                {
                    ResponseBuilder.Add(new TreeResponse(Tree, 1, "This tree was dead in a previous census."));
                }
            }

            return new OkObjectResult(JsonConvert.SerializeObject(ResponseBuilder));
        }
    }
}

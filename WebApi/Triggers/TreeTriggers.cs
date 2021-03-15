using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

using MySql.Data.MySqlClient;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public static class ProcessTrees
    {
        private static string connStr = System.Environment.GetEnvironmentVariable("MySQLConnection", EnvironmentVariableTarget.Process);
        private static MySqlConnection conn = new MySqlConnection(connStr);

        private static Dictionary<(string,string),TreeStorage> QueryTreeDB(string sql){
            var LoadingResponse = new Dictionary<(string,string),TreeStorage>();
            try
            {
                Console.WriteLine("Connecting to MySQL...");
                conn.Open();

                MySqlCommand cmd = new MySqlCommand(sql, conn);
                MySqlDataReader rdr = cmd.ExecuteReader();
                
                while (rdr.Read())
                {
                    var tempTreeStorage = new TreeStorage().MapSQL(rdr);
                    LoadingResponse.Add((tempTreeStorage.Tag,tempTreeStorage.StemTag), tempTreeStorage);
                }
                    
                rdr.Close();
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
                //return new FailedObjectResult("Failed to process request");
            }
            conn.Close();
            Console.WriteLine("Done.");
            
            return LoadingResponse;
        }

        [FunctionName("GetTrees")]
        public static IActionResult GetTrees(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            Dictionary<(string,string),TreeStorage> LoadingResponse = QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");

            return new OkObjectResult(JsonConvert.SerializeObject(LoadingResponse));
        }

        [FunctionName("PostTrees")] 
        public static async Task<IActionResult> PostTrees(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<Tree[]>(requestBody);

            Dictionary<(string,string),TreeStorage> TreeRecords = QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");

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

using System;
using System.Collections;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

using MySql.Data;
using MySql.Data.MySqlClient;

namespace TreeData_CLI
{
    public class TreeRequest
    {
        public int Subquadrant { get; set; }
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public string SpCode { get; set; }
        public int DBH { get; set; }
        public string Codes { get; set; }
        public string Comments { get; set; }
    }
    public class TreeStorage {
        public string TempID { get; set; }
        public string QuadratName { get; set; }
        public string Tag { get; set; }
        public string StemTag { get; set; }
        public string Mnemonic_as_SpCode { get; set; }
        public string DBH { get; set; }
        public string Codes { get; set; }
        public string HOM { get; set; }
        public string ExactDate { get; set; }
        public string x { get; set; }
        public string y { get; set; }
        public string PlotID { get; set; }
        public string CensusID { get; set; }
        public string Errors { get; set; }
    }
    public class TreeResponse
    {
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public int ErrorCode { get; set; }
        public string Error { get; set; }
    }
    public static class TreeDataMock
    {
        [FunctionName("TreeDataMock")]
        public static async Task<IActionResult> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<TreeRequest[]>(requestBody);

            string responseMessage = data[0].SpCode;

            //Create fake errors
            var TreeResponse = new ArrayList();
            foreach(var Tree in data){
                if(Tree.Codes == "dt"){
                    TreeResponse.Add(new TreeResponse{
                        Tag = Tree.Tag, 
                        StemTag = Tree.StemTag,
                        ErrorCode = 1,
                        Error = "Bad Tree"
                    });
                }
            }

            return new OkObjectResult(JsonConvert.SerializeObject(TreeResponse));
        }

        [FunctionName("MySQLTest")]
        public static async Task<IActionResult> MySQLTest(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string connStr = System.Environment.GetEnvironmentVariable("MySQLConnection", EnvironmentVariableTarget.Process);
            
            MySqlConnection conn = new MySqlConnection(connStr);
            var LoadingResponse = new ArrayList();
            try
            {
                log.LogInformation("Connecting to MySQL...");
                conn.Open();

                string sql = "select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants";
                MySqlCommand cmd = new MySqlCommand(sql, conn);
                MySqlDataReader rdr = cmd.ExecuteReader();
                
                while (rdr.Read())
                {
                    LoadingResponse.Add(new TreeStorage{
                        TempID = rdr["TempID"].ToString(),
                        QuadratName = rdr["QuadratName"].ToString(),
                        Tag = rdr["Tag"].ToString(),
                        StemTag = rdr["StemTag"].ToString(),
                        Mnemonic_as_SpCode = rdr[4].ToString(),
                        DBH = rdr["DBH"].ToString(),
                        Codes = rdr["Codes"].ToString(),
                        HOM = rdr["HOM"].ToString(),
                        ExactDate = rdr["ExactDate"].ToString(),
                        x = rdr["x"].ToString(),
                        y = rdr["y"].ToString(),
                        PlotID = rdr["PlotID"].ToString(),
                        CensusID = rdr["CensusID"].ToString(),
                        Errors = rdr["Errors"].ToString()
                    });
                }
                rdr.Close();
            }
            catch (Exception ex)
            {
                log.LogInformation(ex.ToString());
                //return new FailedObjectResult("Failed to process request");
            }
            conn.Close();
            log.LogInformation("Done.");

            return new OkObjectResult(JsonConvert.SerializeObject(LoadingResponse));
        }
    }
}

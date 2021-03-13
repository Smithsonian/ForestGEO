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
        public string Subquadrant { get; set; }
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public string SpCode { get; set; }
        public int DBH { get; set; }
        public string Codes { get; set; }
        public string Comments { get; set; }
        public bool WasDead(ArrayList Trees){
            foreach(TreeStorage tree in Trees){
                if(tree.Tag == Tag && tree.StemTag == StemTag
                    && tree.Codes == "dt" ){
                    return true;
                }
            }
            return false;
        }
    }
    public class TreeStorage {
        public string TempID { get; set; }
        public string QuadratName { get; set; }
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public string SpCode { get; set; }
        public string DBH { get; set; }
        public string Codes { get; set; }
        public string HOM { get; set; }
        public string ExactDate { get; set; }
        public string x { get; set; }
        public string y { get; set; }
        public string PlotID { get; set; }
        public string CensusID { get; set; }
        public string Errors { get; set; }

        public TreeStorage MapSQL(MySqlDataReader rdr){
            TempID = rdr["TempID"].ToString();
            QuadratName = rdr["QuadratName"].ToString();
            Tag = rdr.GetInt32("Tag");
            StemTag = rdr.GetInt32("StemTag");
            SpCode = rdr["SpCode"].ToString();
            DBH = rdr["DBH"].ToString();
            Codes = rdr["Codes"].ToString();
            HOM = rdr["HOM"].ToString();
            ExactDate = rdr["ExactDate"].ToString();
            x = rdr["x"].ToString();
            y = rdr["y"].ToString();
            PlotID = rdr["PlotID"].ToString();
            CensusID = rdr["CensusID"].ToString();
            Errors = rdr["Errors"].ToString();
            return this;
        }
    }
    public class TreeResponse
    {
        public string Subquadrant { get; set; }
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public int ErrorCode { get; set; }
        public string Error { get; set; }
        public TreeResponse (TreeRequest tree, int ecode, string error){
            Subquadrant = tree.Subquadrant;
            Tag = tree.Tag;
            StemTag = tree.StemTag;
            ErrorCode = ecode;
            Error = error;
        }
    }
    public static class TreeDataMock
    {
        private static string connStr = System.Environment.GetEnvironmentVariable("MySQLConnection", EnvironmentVariableTarget.Process);
        private static MySqlConnection conn = new MySqlConnection(connStr);

        private static ArrayList QueryTreeDB(string sql){
            var LoadingResponse = new ArrayList();
            try
            {
                Console.WriteLine("Connecting to MySQL...");
                conn.Open();

                MySqlCommand cmd = new MySqlCommand(sql, conn);
                MySqlDataReader rdr = cmd.ExecuteReader();
                
                while (rdr.Read())
                    LoadingResponse.Add(new TreeStorage().MapSQL(rdr));
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

            ArrayList LoadingResponse = QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");

            return new OkObjectResult(JsonConvert.SerializeObject(LoadingResponse));
        }

        [FunctionName("PostTrees")] 
        public static async Task<IActionResult> PostTrees(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<TreeRequest[]>(requestBody);

            ArrayList LoadingResponse = QueryTreeDB("select TempID, QuadratName, Tag, StemTag, Mnemonic as SpCode, DBH, Codes, HOM, ExactDate, x, y, PlotID, CensusID, Errors from tempnewplants");

            var TreeResponse = new ArrayList();
            foreach(var Tree in data){
                if(Tree.Codes =="at" && Tree.WasDead(LoadingResponse)){
                    TreeResponse.Add(new TreeResponse(Tree, 1, "This tree was dead in a previous census."));
                }
            }

            return new OkObjectResult(JsonConvert.SerializeObject(TreeResponse));
        }
    }
}

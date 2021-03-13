using System.Collections;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

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
                TreeResponse.Add(new TreeResponse{
                    Tag = Tree.Tag, 
                    StemTag = Tree.StemTag,
                    ErrorCode = 1,
                    Error = "Bad Tree"
                    });
            }

            return new OkObjectResult(JsonConvert.SerializeObject(TreeResponse));
        }
    }
}

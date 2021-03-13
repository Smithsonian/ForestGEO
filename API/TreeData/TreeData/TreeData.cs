using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace TreeData
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
        public int Error { get; set; }
    }

    public static class TreeData
    {
        [FunctionName("TreeData")]
        public static async Task<IActionResult> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "TreeData")] HttpRequest req,
            ILogger log)
        {
            log.LogInformation("C# HTTP trigger function processed a request.");

            string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
            var data = JsonConvert.DeserializeObject<TreeRequest[]>(requestBody);

            string responseMessage = data[0].SpCode;

            return new OkObjectResult(responseMessage);
        }
    }
}

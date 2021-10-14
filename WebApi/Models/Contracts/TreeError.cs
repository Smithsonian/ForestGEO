using System.Collections.Generic;

namespace ForestGEO.WebApi.Model.Contracts
{
    public class TreeError
    {
        public int ErrorCode { get; set; }
        public string Column { get; set; }
        public string Message {  get; set; }

    }
}
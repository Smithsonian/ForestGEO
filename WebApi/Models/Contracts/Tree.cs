using System.Collections;

namespace ForestGEO.WebApi.Model.Contracts
{
    public class Tree
    {
        public int SiteId {  get; set; }
        public string Subquadrat { get; set; }
        public int Tag { get; set; }
        public int StemTag { get; set; }
        public string SpCode { get; set; }
        public double DBH { get; set; }
        public string Codes { get; set; }
        public string Comments { get; set; }
    }
}
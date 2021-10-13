using System.Collections;

namespace ForestGEO.WebApi.Model.Contracts
{
    public class Tree
    {
        // The Type property is used to differentiate all the different types of documents in the Cosmos DB (ie, "tree" vs "plot", etc)
        public string Type => "tree";
        public int CensusId {  get; set; }
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
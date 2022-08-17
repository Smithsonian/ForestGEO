using System.Collections.Generic;

namespace ForestGEO.WebApi.Model.Contracts
{
    public class Tree
    {
        // The Type property is used to differentiate all the different types of documents in the Cosmos DB (ie, "tree" vs "plot", etc)
        public string Type => "tree";
        public int CensusId { get; set; }
        public int PlotId { get; set; }
        public int Subquadrat { get; set; }
        public string Tag { get; set; }
        public string StemTag { get; set; }
        public string SpCode { get; set; }
        public double? DBH { get; set; }
        public double? Htmeas { get; set; }
        public string Codes { get; set; }
        public string Comments { get; set; }

        // Errors resulting from cloud-side validation when POST'ing the tree.
        public IList<TreeError> Errors { get; set; }
    }
}
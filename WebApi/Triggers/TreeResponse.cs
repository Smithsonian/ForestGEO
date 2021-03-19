namespace ForestGEO.WebApi.Triggers.Tree
{
    public class TreeResponse
    {
        public string Subquadrat { get; set; }
        public string Tag { get; set; }
        public string StemTag { get; set; }
        public int ErrorCode { get; set; }
        public string Error { get; set; }
        public TreeResponse (ForestGEO.WebApi.Model.Contracts.Tree tree, int ecode, string error)
        {
            Subquadrat = tree.Subquadrat;
            Tag = tree.Tag;
            StemTag = tree.StemTag;
            ErrorCode = ecode;
            Error = error;
        }
    }
}
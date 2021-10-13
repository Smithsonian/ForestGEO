namespace ForestGEO.WebApi.Triggers.Tree
{
    using Model.Contracts;
    internal class MockData
    {
        public static Tree[] TreeData = new Tree[]
        {
            new Tree()
            {
                SiteId = 2,
                Subquadrat = "11",
                Tag = 1,
                StemTag = 1,
                SpCode = "species",
                DBH = 10,
                Codes = "at",
                Comments = "",
            },
            new Tree()
            {
                SiteId = 2,
                Subquadrat = "21",
                Tag = 2,
                StemTag = 1,
                SpCode = "species",
                DBH = 10,
                Codes = "at",
                Comments = "",
            },
        };
    }
}
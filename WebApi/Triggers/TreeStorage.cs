using MySql.Data.MySqlClient;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public class TreeStorage {
        public int TempID { get; set; }
        public string QuadratName { get; set; }
        public string Tag { get; set; }
        public string StemTag { get; set; }
        public string SpCode { get; set; }
        public double DBH { get; set; }
        public string Codes { get; set; }
        public string HOM { get; set; }
        public string ExactDate { get; set; }
        public double x { get; set; }
        public double y { get; set; }
        public string PlotID { get; set; }
        public string CensusID { get; set; }
        public string Errors { get; set; }
        public bool IsDead()
        {
          return Codes.Contains("dt");
        }
        public TreeStorage MapSQL(MySqlDataReader rdr)
        {
            TempID = rdr.GetInt32("TempID");
            QuadratName = rdr["QuadratName"].ToString();
            Tag = rdr["Tag"].ToString();
            StemTag = rdr["StemTag"].ToString();
            SpCode = rdr["SpCode"].ToString();
            DBH = rdr.GetDouble("DBH");
            Codes = rdr["Codes"].ToString();
            HOM = rdr["HOM"].ToString();
            ExactDate = rdr["ExactDate"].ToString();
            x = rdr.GetDouble("x");
            y = rdr.GetDouble("y");
            PlotID = rdr["PlotID"].ToString();
            CensusID = rdr["CensusID"].ToString();
            Errors = rdr["Errors"].ToString();
            return this;
        }
    }
}
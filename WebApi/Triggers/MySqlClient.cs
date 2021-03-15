using System;
using System.Collections.Generic;
using MySql.Data.MySqlClient;

namespace ForestGEO.WebApi.Triggers.Tree
{
    public class MySqlClient
    {
        private static string connStr = System.Environment.GetEnvironmentVariable("MySQLConnection", EnvironmentVariableTarget.Process);
        private static MySqlConnection conn = new MySqlConnection(connStr);

        public Dictionary<(string,string),TreeStorage> QueryTreeDB(string sql){
            var LoadingResponse = new Dictionary<(string,string),TreeStorage>();
            try
            {
                conn.Open();

                MySqlCommand cmd = new MySqlCommand(sql, conn);
                MySqlDataReader rdr = cmd.ExecuteReader();
                
                while (rdr.Read())
                {
                    var tempTreeStorage = new TreeStorage().MapSQL(rdr);
                    LoadingResponse.Add((tempTreeStorage.Tag,tempTreeStorage.StemTag), tempTreeStorage);
                }
                    
                rdr.Close();
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.ToString());
            }
            conn.Close();
            
            return LoadingResponse;
        }
    }
}
using Microsoft.Azure.Cosmos;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ForestGEO.WebApi.Triggers.Tree
{
    internal class CosmosController
    {
        public static async Task<List<Model.Contracts.Tree>> QueryCosmos(string sqlQueryText, Container container)
        {

            QueryDefinition queryDefinition = new QueryDefinition(sqlQueryText);
            FeedIterator<Model.Contracts.Tree> queryResultSetIterator = container.GetItemQueryIterator<Model.Contracts.Tree>(queryDefinition);

            List<Model.Contracts.Tree> trees = new List<Model.Contracts.Tree>();

            while (queryResultSetIterator.HasMoreResults)
            {
                FeedResponse<Model.Contracts.Tree> currentResultSet = await queryResultSetIterator.ReadNextAsync();
                foreach (Model.Contracts.Tree tree in currentResultSet)
                {
                    trees.Add(tree);
                }
            }

            return trees;
        }

        public static async Task<Dictionary<(string,int),Model.Contracts.Tree>> QueryCosmosToDictionary(string sqlQueryText, Container container)
        {
            List<Model.Contracts.Tree> trees = await QueryCosmos(sqlQueryText, container);
            var result = new Dictionary<(string, int), Model.Contracts.Tree>();
            foreach(var tree in trees)
            {
                if(!result.ContainsKey((tree.Tag, tree.Subquadrat)))
                {
                    result.Add (
                        (tree.Tag, tree.Subquadrat),
                        tree);
                }
            }
            return result;
        }
    }
}
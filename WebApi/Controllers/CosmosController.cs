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
    }
}
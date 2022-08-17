using ForestGEO.WebApi.Model.Contracts;
using System;
using System.Collections.Generic;

namespace ForestGEO.WebApi.Model.Utilities
{
    public class TreeUtilities
    {
        private static readonly TreeError TreeDeadError = new TreeError(){
            ErrorCode = 1,
            Column = "Codes",
            Message = "This tree was dead in a previous census"
        };

        public static string TreeSQLQuery(int plotId, int censusId)
        {
            return $"SELECT * FROM TreeMeasures WHERE TreeMeasures.CensusId = {censusId} AND TreeMeasures.PlotId = {plotId}";
        }
        public static Tree[] CheckDeadTrees(Tree[] currentCensus, Dictionary<(string, int), Tree> priorCensus)
        {
            for(int i = 0; i < currentCensus.Length; i++)
            {
                var priorTree = priorCensus[(currentCensus[i].Tag, currentCensus[i].Subquadrat)];
                if (priorTree != null &&
                    !currentCensus[i].Codes.Contains("D",StringComparison.OrdinalIgnoreCase) &&
                    priorTree.Codes.Contains("D",StringComparison.OrdinalIgnoreCase))
                {
                    if (currentCensus[i].Errors == null)
                    {
                        currentCensus[i].Errors = new List<TreeError>() { TreeDeadError };
                    }
                    else
                    {
                        currentCensus[i].Errors.Add(TreeDeadError);
                    }
                }
            }
            return currentCensus;
        }
    }
}
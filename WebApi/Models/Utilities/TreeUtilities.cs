using ForestGEO.WebApi.Model.Contracts;
using System;
using System.Collections.Generic;

namespace ForestGEO.WebApi.Model.Utilities
{
    public class TreeUtilities
    {
        private static readonly string TreeDeadErrorMessage = "This tree was dead in a previous census";

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
                        currentCensus[i].Errors = new List<string>() 
                            { TreeDeadErrorMessage };
                    }
                    else
                    {
                        currentCensus[i].Errors.Add(TreeDeadErrorMessage);
                    }
                }
            }
            return currentCensus;
        }
    }
}
import os
import azure.functions as func
import logging
import mysql.connector
from mysql.connector import Error
import json
from datetime import datetime, timezone

app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)

@app.route(route="ingestionprocessor")
def ingestionprocessor(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Processing ingestionprocessor request.')

    schema = req.params.get('schema')
    plotID = req.params.get('plotID')
    plotCensusNumber = req.params.get('plotCensusNumber')
    if not schema or not plotID or not plotCensusNumber:
        try:
            req_body = req.get_json()
        except ValueError:
            pass
        else:
            schema = req_body.get('schema')
            plotID = req_body.get('plotID')
            plotCensusNumber = req_body.get('plotCensusNumber')

    if not schema or not plotID or not plotCensusNumber:
        return func.HttpResponse(
            json.dumps({"error": "Missing required parameters: schema, plotID, plotCensusNumber"}),
            status_code=400,
            headers={'Content-Type': 'application/json'}
        )

    cnx = None
    cursor = None
    try: 
        cnx = mysql.connector.connect(
            host=os.environ['AZURE_SQL_SERVER'],
            user = os.environ['AZURE_SQL_USER'],
            password=os.environ['AZURE_SQL_PASSWORD'],
            port=os.environ['AZURE_SQL_PORT'],
            database=schema)
        cursor = cnx.cursor(dictionary=True)

        file_batch_query = 'SELECT distinct tm.FileID, tm.BatchID from temporarymeasurements tm join census c on tm.CensusID = c.CensusID and tm.PlotID = c.PlotID where c.PlotID = %s and c.PlotCensusNumber = %s'
        cursor.execute(file_batch_query, (plotID, plotCensusNumber,))
        file_batch_set = cursor.fetchall()

        # Log initial collection results
        total_batches = len(file_batch_set)
        unique_files = len(set(row['FileID'] if isinstance(row, dict) else row[0] for row in file_batch_set))
        logging.info(f"Found {total_batches} batches across {unique_files} unique files for PlotID {plotID}, Census {plotCensusNumber}")
        
        if total_batches == 0:
            logging.warning(f"No batches found for PlotID {plotID}, Census {plotCensusNumber}")
        
        processed_batches = []
        failed_batches = []
        
        for i, row in enumerate(file_batch_set, 1):
            FileID = None
            BatchID = None
            if isinstance(row, dict):
                FileID, BatchID = row['FileID'], row['BatchID']
            else:
                FileID, BatchID = row[0], row[1]
            
            try:
                logging.info(f"Processing batch {i}/{total_batches}: FileID={FileID}, BatchID={BatchID}")
                
                # Call stored procedure with FileID and BatchID
                cursor.callproc('bulkingestionprocessor', [FileID, BatchID])
                
                # Consume any results from the stored procedure to avoid "Unread result found" errors
                for result in cursor.stored_results():
                    result.fetchall()
                
                processed_batches.append({"FileID": FileID, "BatchID": BatchID})
                logging.info(f"Successfully processed batch {i}/{total_batches}: FileID={FileID}, BatchID={BatchID}")
                
            except Exception as batch_error:
                error_msg = f"Failed to process batch {i}/{total_batches}: FileID={FileID}, BatchID={BatchID} - Error: {str(batch_error)}"
                logging.error(error_msg)
                failed_batches.append({"FileID": FileID, "BatchID": BatchID, "error": str(batch_error)})
            
        # Log final processing summary
        successful_count = len(processed_batches)
        failed_count = len(failed_batches)
        logging.info(f"Processing complete: {successful_count} successful, {failed_count} failed out of {total_batches} total batches")
        
        response_data = {
            "message": f"Processing complete: {successful_count} successful, {failed_count} failed out of {total_batches} total batches",
            "processed_batches": processed_batches,
            "failed_batches": failed_batches,
            "total_batches": total_batches,
            "successful_count": successful_count,
            "failed_count": failed_count,
            "unique_files": unique_files,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        return func.HttpResponse(
            json.dumps(response_data),
            status_code=200,
            headers={'Content-Type': 'application/json'}
        )

    except Error as e:
        logging.error(f"Database error: {e}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            headers={'Content-Type': 'application/json'}
        )
    finally:
        if cursor:
            cursor.close()
        if cnx:
            cnx.close()
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

    def generate_sse_stream():
        cnx = None
        cursor = None
        try: 
            cnx = mysql.connector.connect(
                user = os.environ['AZURE_SQL_USER'],
                password=os.environ['AZURE_SQL_PASSWORD'],
                port=os.environ['AZURE_SQL_PORT'],
                database=schema)
            cursor = cnx.cursor(dictionary=True)

            file_batch_query = 'SELECT distinct tm.FileID, tm.BatchID from temporarymeasurements tm join census c on tm.CensusID = c.CensusID and tm.PlotID = c.PlotID where c.PlotID = %s and c.PlotCensusNumber = %s'
            cursor.execute(file_batch_query, (plotID, plotCensusNumber,))
            file_batch_set = cursor.fetchall()

            # Send initial count
            initial_data = {
                "type": "start",
                "total_batches": len(file_batch_set),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            yield f"data: {json.dumps(initial_data)}\n\n"

            for row in file_batch_set:
                FileID = None
                BatchID = None
                if isinstance(row, dict):
                    FileID, BatchID = row['FileID'], row['BatchID']
                else:
                    FileID, BatchID = row[0], row[1]
                
                # Call stored procedure with FileID and BatchID
                cursor.callproc('bulkingestionprocessor', [FileID, BatchID])
                
                # Send completion event immediately
                completion_data = {
                    "type": "completed",
                    "FileID": FileID,
                    "BatchID": BatchID,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                yield f"data: {json.dumps(completion_data)}\n\n"
                
            # Send final completion
            final_data = {
                "type": "finished",
                "message": f"Successfully processed {len(file_batch_set)} file batches",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            yield f"data: {json.dumps(final_data)}\n\n"

        except Error as e:
            logging.error(f"Database error: {e}")
            error_data = {
                "type": "error",
                "error": str(e),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            yield f"data: {json.dumps(error_data)}\n\n"
        finally:
            if 'cursor' in locals() and cursor:
                cursor.close()
            if 'cnx' in locals() and cnx:
                cnx.close()

    # Generate all SSE events
    response_body = ""
    for chunk in generate_sse_stream():
        response_body += chunk
    
    return func.HttpResponse(
        response_body,
        status_code=200,
        headers={
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        },
        mimetype='text/event-stream'
    )
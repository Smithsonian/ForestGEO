import decimal
import json
import azure.functions as func
import logging
import os
import mysql.connector
from mysql.connector import Error

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


def convert_decimals(obj):
    if isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    elif isinstance(obj, dict):
        return {
            key:
            (float(value) if isinstance(value, decimal.Decimal) else value)
            for key, value in obj.items()
        }
    return obj


@app.route(route="polluserstate", auth_level=func.AuthLevel.ANONYMOUS)
def polluserstate(req: func.HttpRequest) -> func.HttpResponse:
    logging.info('Processing polluserstate request')

    # Retrieve email from query parameters or JSON body
    email = req.params.get('email')
    if not email:
        try:
            req_body = req.get_json()
            email = req_body.get('email')
        except ValueError:
            email = None

    if not email:
        return func.HttpResponse(
            "Please provide an email in the query string or request body.",
            status_code=400)

    cnx = None
    cursor = None
    
    try:
        cnx = mysql.connector.connect(
            user=os.environ['AZURE_SQL_USER'],
            password=os.environ['AZURE_SQL_PASSWORD'],
            host=os.environ['AZURE_SQL_SERVER'],
            port=os.environ['AZURE_SQL_PORT'],
            database=os.environ['AZURE_SQL_CATALOG_SCHEMA'])
        cursor = cnx.cursor(dictionary=True)  # type: ignore

        allsites_query = 'SELECT * FROM sites'
        cursor.execute(allsites_query)
        all_sites = convert_decimals(cursor.fetchall())

        query = "SELECT UserID, UserStatus FROM users WHERE Email = %s LIMIT 1"
        cursor.execute(query, (email, ))
        result = cursor.fetchone()

        if result:
            user_id: int = result['UserID']  # type: ignore
            user_status: str = result['UserStatus']  # type: ignore
            site_query = 'SELECT s.* FROM sites AS s JOIN usersiterelations AS usr ON s.SiteID = usr.SiteID WHERE usr.UserID = %s'
            cursor.execute(site_query, (user_id,))
            allowed_sites = convert_decimals(cursor.fetchall())
            response_body = {
                "userStatus": user_status,
                "allSites": all_sites,
                "allowedSites": allowed_sites
            }
            return func.HttpResponse(json.dumps(response_body),
                                     status_code=200,
                                     mimetype="application/json")
        else:
            return func.HttpResponse("User not found", status_code=404)

    except Error as e:
        logging.error(f"Database error: {e}")
        return func.HttpResponse(f"Internal server error with error {e}.",
                                 status_code=500)
    finally:
        if cursor is not None:
            cursor.close()
        if cnx is not None:
            cnx.close()

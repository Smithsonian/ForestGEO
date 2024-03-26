#!/bin/bash

# URLs for the live site and local development instance
LIVE_URL="https://forestgeolivesite.azurewebsites.net/api/sqlmonitor"
LOCAL_URL="http://localhost:3000/api/sqlmonitor"

# Function to check URL and log if successful
check_and_log() {
    URL=$1
    LOG_FILE=$2

    # Get current timestamp
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

    # Check if the URL is reachable
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $URL)

    # Log only if the request is successful (HTTP status 200)
    if [ "$RESPONSE" == "200" ]; then
        echo "$TIMESTAMP: Success for $URL" >> $LOG_FILE
    fi
}

# File paths for the logs
LIVE_LOG="/Users/sambokar/Documents/ForestGEO/frontend/scripts/logs/live_cron.log"
LOCAL_LOG="/Users/sambokar/Documents/ForestGEO/frontend/scripts/logs/local_cron.log"

# Check and log for both URLs
check_and_log $LIVE_URL $LIVE_LOG
check_and_log $LOCAL_URL $LOCAL_LOG


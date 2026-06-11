// ForestGEO Testing Environment Resources
// Mirrors production resource types with smaller SKUs for cost efficiency

// ── Parameters ──────────────────────────────────────────────────────────────

param environment string
param location string
param mysqlAdminUser string

@secure()
param mysqlAdminPassword string

param mysqlSkuName string
param mysqlSkuTier string
param mysqlStorageGb int
param mysqlVersion string
param appServiceSkuName string
param nodeVersion string
param functionNodeVersion string
param storageRedundancy string
param serviceBusSkuName string

@secure()
param asyncUploadWorkerToken string = ''

// ── Naming Convention ───────────────────────────────────────────────────────

var nameSuffix = 'forestgeo-${environment}'
var mysqlServerName = '${nameSuffix}-mysql'
var appServicePlanName = '${nameSuffix}-plan'
var appServiceName = '${nameSuffix}-app'
var functionAppPlanName = '${nameSuffix}-jobs-plan'
var functionAppName = '${nameSuffix}-jobs-func'
var storageAccountName = replace('fg${environment}storage', '-', '')
var appInsightsName = '${nameSuffix}-insights'
var logAnalyticsName = '${nameSuffix}-logs'
var serviceBusNamespaceName = '${nameSuffix}-sb'
var uploadJobQueueName = 'upload-processing-jobs'

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${az.environment().suffixes.storage}'

// ── Log Analytics Workspace (required for App Insights) ─────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── Application Insights ────────────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── MySQL Flexible Server ───────────────────────────────────────────────────

resource mysqlServer 'Microsoft.DBforMySQL/flexibleServers@2023-12-30' = {
  name: mysqlServerName
  location: location
  sku: {
    name: mysqlSkuName
    tier: mysqlSkuTier
  }
  properties: {
    administratorLogin: mysqlAdminUser
    administratorLoginPassword: mysqlAdminPassword
    version: mysqlVersion
    storage: {
      storageSizeGB: mysqlStorageGb
      autoGrow: 'Enabled'
      autoIoScaling: 'Enabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// Allow Azure services to connect to MySQL
resource mysqlFirewallAllowAzure 'Microsoft.DBforMySQL/flexibleServers/firewallRules@2023-12-30' = {
  parent: mysqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Storage Account ─────────────────────────────────────────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: storageRedundancy
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource storageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'forestgeo-${environment}-storage'
  properties: {
    publicAccess: 'None'
  }
}

// ── Service Bus Queue For Background Upload Jobs ────────────────────────────

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: serviceBusNamespaceName
  location: location
  sku: {
    name: serviceBusSkuName
    tier: serviceBusSkuName
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    minimumTlsVersion: '1.2'
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

resource uploadJobQueue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: serviceBusNamespace
  name: uploadJobQueueName
  properties: {
    lockDuration: 'PT5M'
    maxDeliveryCount: 10
    defaultMessageTimeToLive: 'P14D'
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
  }
}

resource serviceBusRootRule 'Microsoft.ServiceBus/namespaces/authorizationRules@2024-01-01' existing = {
  parent: serviceBusNamespace
  name: 'RootManageSharedAccessKey'
}

// ── App Service Plan ────────────────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  properties: {
    reserved: true // required for Linux
  }
  sku: {
    name: appServiceSkuName
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── Function App Plan For Background Upload Workers ─────────────────────────

resource functionAppPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: functionAppPlanName
  location: location
  kind: 'functionapp'
  properties: {
    reserved: true
  }
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── App Service (Web App) ───────────────────────────────────────────────────

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|${nodeVersion}'
      alwaysOn: false // save cost in testing
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AZURE_SQL_SERVER', value: mysqlServer.properties.fullyQualifiedDomainName }
        { name: 'AZURE_SQL_PORT', value: '3306' }
        { name: 'AZURE_SQL_USER', value: mysqlAdminUser }
        { name: 'AZURE_SQL_PASSWORD', value: mysqlAdminPassword }
        { name: 'AZURE_SQL_SCHEMA', value: 'forestgeo_testing' }
        { name: 'AZURE_SQL_CATALOG_SCHEMA', value: 'catalog' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storageAccount.name }
        { name: 'AZURE_STORAGE_CONNECTION_STRING', value: storageConnectionString }
        { name: 'AZURE_STORAGE_CONTAINER_NAME', value: 'forestgeo-${environment}-storage' }
        { name: 'AZURE_SERVICE_BUS_CONNECTION_STRING', value: serviceBusRootRule.listKeys().primaryConnectionString }
        { name: 'AZURE_SERVICE_BUS_UPLOAD_QUEUE_NAME', value: uploadJobQueue.name }
        { name: 'ASYNC_UPLOAD_ENABLED', value: 'false' }
        { name: 'ASYNC_UPLOAD_ALLOWED_USERS', value: '' }
        { name: 'ASYNC_UPLOAD_ALLOWED_SCHEMAS', value: '' }
        { name: 'ASYNC_UPLOAD_ALLOWED_FORMS', value: '' }
        { name: 'ASYNC_UPLOAD_WORKER_ENABLED', value: 'false' }
        { name: 'ASYNC_UPLOAD_WORKER_TOKEN', value: asyncUploadWorkerToken }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~${split(nodeVersion, '-')[0]}' }
      ]
    }
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── Function App (Background Upload Worker Host) ────────────────────────────

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionAppPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|${functionNodeVersion}'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'AzureWebJobsStorage', value: storageConnectionString }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'AZURE_SQL_SERVER', value: mysqlServer.properties.fullyQualifiedDomainName }
        { name: 'AZURE_SQL_PORT', value: '3306' }
        { name: 'AZURE_SQL_USER', value: mysqlAdminUser }
        { name: 'AZURE_SQL_PASSWORD', value: mysqlAdminPassword }
        { name: 'AZURE_SQL_SCHEMA', value: 'forestgeo_testing' }
        { name: 'AZURE_SQL_CATALOG_SCHEMA', value: 'catalog' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storageAccount.name }
        { name: 'AZURE_STORAGE_CONNECTION_STRING', value: storageConnectionString }
        { name: 'AZURE_STORAGE_CONTAINER_NAME', value: 'forestgeo-${environment}-storage' }
        { name: 'AZURE_SERVICE_BUS_CONNECTION_STRING', value: serviceBusRootRule.listKeys().primaryConnectionString }
        { name: 'AZURE_SERVICE_BUS_UPLOAD_QUEUE_NAME', value: uploadJobQueue.name }
        { name: 'ASYNC_UPLOAD_ENABLED', value: 'false' }
        { name: 'ASYNC_UPLOAD_ALLOWED_USERS', value: '' }
        { name: 'ASYNC_UPLOAD_ALLOWED_SCHEMAS', value: '' }
        { name: 'ASYNC_UPLOAD_ALLOWED_FORMS', value: '' }
        { name: 'ASYNC_UPLOAD_WORKER_ENABLED', value: 'false' }
        { name: 'ASYNC_UPLOAD_WORKER_TOKEN', value: asyncUploadWorkerToken }
        { name: 'ASYNC_UPLOAD_PROCESSOR_BASE_URL', value: 'https://${appService.properties.defaultHostName}' }
        { name: 'BACKGROUND_UPLOAD_WORKER_CONCURRENCY', value: '1' }
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
  tags: {
    environment: environment
    project: 'ForestGEO'
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output mysqlServerFqdn string = mysqlServer.properties.fullyQualifiedDomainName
output mysqlServerName string = mysqlServer.name
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'
output appServiceName string = appService.name
output storageAccountName string = storageAccount.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output functionAppName string = functionApp.name
output serviceBusNamespaceName string = serviceBusNamespace.name
output uploadJobQueueName string = uploadJobQueue.name

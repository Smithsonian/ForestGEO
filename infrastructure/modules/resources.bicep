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
param storageRedundancy string

// ── Naming Convention ───────────────────────────────────────────────────────

var nameSuffix = 'forestgeo-${environment}'
var mysqlServerName = '${nameSuffix}-mysql'
var appServicePlanName = '${nameSuffix}-plan'
var appServiceName = '${nameSuffix}-app'
var storageAccountName = replace('fg${environment}storage', '-', '')
var appInsightsName = '${nameSuffix}-insights'
var logAnalyticsName = '${nameSuffix}-logs'

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
        { name: 'AZURE_SQL_SCHEMA', value: 'forestgeo_testing' }
        { name: 'AZURE_SQL_CATALOG_SCHEMA', value: 'catalog' }
        { name: 'AZURE_STORAGE_ACCOUNT', value: storageAccount.name }
        { name: 'AZURE_STORAGE_CONTAINER_NAME', value: 'forestgeo-${environment}-storage' }
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

// ── Outputs ─────────────────────────────────────────────────────────────────

output mysqlServerFqdn string = mysqlServer.properties.fullyQualifiedDomainName
output mysqlServerName string = mysqlServer.name
output appServiceUrl string = 'https://${appService.properties.defaultHostName}'
output appServiceName string = appService.name
output storageAccountName string = storageAccount.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString

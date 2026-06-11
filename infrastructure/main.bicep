// ForestGEO Testing Resource Group - Separate from Production
// Deploys an isolated Azure environment for integration testing
//
// Usage:
//   az deployment sub create \
//     --location eastus \
//     --template-file infrastructure/main.bicep \
//     --parameters infrastructure/parameters.testing.json

targetScope = 'subscription'

// ── Parameters ──────────────────────────────────────────────────────────────

@description('Environment name used as prefix for all resources')
@allowed(['testing', 'staging'])
param environment string = 'testing'

@description('Azure region for all resources')
param location string = 'eastus'

@description('MySQL administrator login name')
param mysqlAdminUser string = 'azureroot'

@secure()
@description('MySQL administrator password')
param mysqlAdminPassword string

@description('MySQL server SKU name (use a smaller tier for testing)')
param mysqlSkuName string = 'Standard_B1ms'

@description('MySQL server SKU tier')
@allowed(['Burstable', 'GeneralPurpose', 'MemorySOptimized'])
param mysqlSkuTier string = 'Burstable'

@description('MySQL storage size in GB')
param mysqlStorageGb int = 20

@description('MySQL version')
param mysqlVersion string = '8.0.21'

@description('App Service plan SKU (use a cheaper tier for testing)')
param appServiceSkuName string = 'B1'

@description('Node.js version for the App Service')
param nodeVersion string = '24-lts'

@description('Storage account redundancy')
@allowed(['Standard_LRS', 'Standard_GRS'])
param storageRedundancy string = 'Standard_LRS'

// ── Resource Group ──────────────────────────────────────────────────────────

var resourceGroupName = 'forestgeo-${environment}-rg'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    environment: environment
    project: 'ForestGEO'
    managedBy: 'bicep'
  }
}

// ── Module: All resources deployed into the new resource group ───────────────

module resources 'modules/resources.bicep' = {
  name: 'forestgeo-${environment}-resources'
  scope: rg
  params: {
    environment: environment
    location: location
    mysqlAdminUser: mysqlAdminUser
    mysqlAdminPassword: mysqlAdminPassword
    mysqlSkuName: mysqlSkuName
    mysqlSkuTier: mysqlSkuTier
    mysqlStorageGb: mysqlStorageGb
    mysqlVersion: mysqlVersion
    appServiceSkuName: appServiceSkuName
    nodeVersion: nodeVersion
    storageRedundancy: storageRedundancy
  }
}

// ── Outputs ─────────────────────────────────────────────────────────────────

output resourceGroupName string = rg.name
output mysqlServerFqdn string = resources.outputs.mysqlServerFqdn
output mysqlServerName string = resources.outputs.mysqlServerName
output appServiceUrl string = resources.outputs.appServiceUrl
output appServiceName string = resources.outputs.appServiceName
output storageAccountName string = resources.outputs.storageAccountName

provider "azurerm" {
  features {}
}

provider "azurerm" {
  alias           = "webpubsub_vnet_provider"
  subscription_id = var.private_endpoint_subscription_id

  features {}
}

locals {
  app_full_name              = "rpx-${var.component}"
  ase_name                   = "core-compute-${var.env}"
  local_env                  = (var.env == "preview" || var.env == "spreview") ? (var.env == "preview") ? "aat" : "saat" : var.env
  shared_vault_name          = "${var.shared_product_name}-${local.local_env}"
  managed_redis_environments = toset(var.env == "demo" ? [var.env] : [])
}

data "azurerm_key_vault" "key_vault" {
  name                = local.shared_vault_name
  resource_group_name = local.shared_vault_name
}

data "azurerm_user_assigned_identity" "rpx_shared_identity" {
  name                = "rpx-${var.env}-mi"
  resource_group_name = "managed-identities-${var.env}-rg"
}

data "azurerm_subnet" "cft_infra_web_pubsub_subnet" {
  provider = azurerm.webpubsub_vnet_provider

  name                 = "private-endpoints"
  virtual_network_name = "cft-${var.env}-vnet"
  resource_group_name  = "cft-${var.env}-network-rg"
}


resource "azurerm_key_vault_secret" "redis_connection_string" {
  name         = "activity-redis-password"
  value        = module.redis-activity-service.access_key
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_key_vault_secret" "managed_redis_access_key" {
  for_each = local.managed_redis_environments

  name         = "activity-managed-redis-password"
  value        = module.managed-redis-activity-service[each.key].primary_access_key
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

module "application_insights" {
  source = "git@github.com:hmcts/terraform-module-application-insights?ref=4.x"

  env                 = var.env
  product             = var.product
  name                = "${local.app_full_name}-appinsights"
  location            = var.location
  application_type    = var.application_type
  resource_group_name = azurerm_resource_group.rg.name
  alert_limit_reached = true
  sampling_percentage = var.sampling_percentage

  common_tags = var.common_tags
}

resource "azurerm_resource_group" "rg" {
  name     = "${local.app_full_name}-${var.env}"
  location = var.location

  tags = var.common_tags
}

module "redis-activity-service" {
  source                        = "git@github.com:hmcts/cnp-module-redis?ref=4.x"
  product                       = "${var.product}-activity-service"
  location                      = var.location
  env                           = var.env
  private_endpoint_enabled      = true
  redis_version                 = "6"
  business_area                 = "cft" # cft or sds
  public_network_access_enabled = false
  common_tags                   = var.common_tags
  sku_name                      = var.sku_name
  family                        = var.family
  capacity                      = var.capacity
}

module "managed-redis-activity-service" {
  for_each = local.managed_redis_environments

  source = "git@github.com:hmcts/terraform-module-azure-managed-redis?ref=main"

  product     = var.product
  component   = "activity-service"
  name        = "${var.product}-activity-service-managed"
  env         = var.env
  location    = var.location
  common_tags = var.common_tags

  sku_name                           = var.managed_redis_sku_name
  access_keys_authentication_enabled = true
  public_network_access              = "Disabled"
  create_private_endpoint            = true
  subnet_id                          = data.azurerm_subnet.cft_infra_web_pubsub_subnet.id
  private_dns_zone_ids = [
    "/subscriptions/${var.private_endpoint_subscription_id}/resourceGroups/core-infra-intsvc-rg/providers/Microsoft.Network/privateDnsZones/privatelink.redis.azure.net"
  ]
}

resource "azurerm_key_vault_secret" "app_insights_connection_string" {
  name         = "app-insights-connection-string-at"
  value        = module.application_insights.connection_string
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_web_pubsub" "case_activity" {
  name                          = "${local.app_full_name}-webpubsub-${var.env}"
  location                      = var.location
  resource_group_name           = azurerm_resource_group.rg.name
  sku                           = "Standard_S1"
  capacity                      = 1
  public_network_access_enabled = false

  live_trace {
    enabled                   = true
    messaging_logs_enabled    = true
    connectivity_logs_enabled = false
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.rpx_shared_identity.id]
  }

  tags = var.common_tags
}

resource "azurerm_private_endpoint" "case_activity_web_pubsub" {
  provider = azurerm.webpubsub_vnet_provider

  name                = "${local.app_full_name}-webpubsub-${var.env}-privateendpoint"
  resource_group_name = "cft-${var.env}-network-rg"
  location            = var.location
  subnet_id           = data.azurerm_subnet.cft_infra_web_pubsub_subnet.id

  private_service_connection {
    name                           = "${local.app_full_name}-webpubsub-${var.env}-service-connection"
    is_manual_connection           = false
    private_connection_resource_id = azurerm_web_pubsub.case_activity.id
    subresource_names              = ["webpubsub"]
  }
}

resource "azurerm_web_pubsub_network_acl" "case_activity" {
  web_pubsub_id  = azurerm_web_pubsub.case_activity.id
  default_action = "Allow"

  public_network {}

  private_endpoint {
    id = azurerm_private_endpoint.case_activity_web_pubsub.id
  }
}

resource "azurerm_web_pubsub_hub" "case_activity" {
  name                          = "hub"
  web_pubsub_id                 = azurerm_web_pubsub.case_activity.id
  anonymous_connections_enabled = true
}

resource "azurerm_key_vault_secret" "web_pubsub_primary_connection_string" {
  name         = "rpx-case-activity-api-web-pubsub-primary-connection-string"
  value        = azurerm_web_pubsub.case_activity.primary_connection_string
  key_vault_id = data.azurerm_key_vault.key_vault.id
}

resource "azurerm_role_assignment" "web_pubsub_service_owner" {
  for_each = local.local_env != "prod" ? toset(var.web_pubsub_owner_ids) : toset([])

  scope                = azurerm_web_pubsub.case_activity.id
  role_definition_name = "Web PubSub Service Owner"
  principal_id         = each.value
}

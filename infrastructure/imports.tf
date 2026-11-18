# The AAT cache already exists in Azure but is missing from this Terraform state.
# Keep the import scoped to AAT so other environments can create their own cache.
data "azurerm_client_config" "current" {}

import {
  for_each = var.env == "aat" ? toset(["aat"]) : toset([])

  to = module.managed_redis.azurerm_managed_redis.redis
  id = "/subscriptions/${data.azurerm_client_config.current.subscription_id}/resourceGroups/${var.product}-${var.component}-${each.value}-rg/providers/Microsoft.Cache/redisEnterprise/${var.product}-${var.component}-${each.value}"
}

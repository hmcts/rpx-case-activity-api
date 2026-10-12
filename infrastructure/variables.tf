variable "product" {
  default     = "rpx"
  description = "The name of your application"
}
variable "location" {
  default = "UK South"
}

variable "component" {}

variable "env" {
  description = "(Required) The environment in which to deploy the application infrastructure."
}

variable "common_tags" {
  type = map(string)
}

variable "application_type" {
  default     = "web"
  description = "Type of Application Insights (Web/Other)"
}

variable "family" {
  default     = "C"
  description = "The SKU family/pricing group to use. Valid values are `C` (for Basic/Standard SKU family) and `P` (for Premium). Use P for higher availability, but beware it costs a lot more."
}

variable "sku_name" {
  default     = "Basic"
  description = "The SKU of Redis to use. Possible values are `Basic`, `Standard` and `Premium`."
}

variable "capacity" {
  default     = "1"
  description = "The size of the Redis cache to deploy. Valid values are 1, 2, 3, 4, 5"
}

variable "shared_product_name" {
  default = "rpx"
}

variable "sampling_percentage" {
  default     = 1
  description = "Specifies the sampling percentage for Application Insights"
}

variable "private_endpoint_subscription_id" {
  description = "Subscription ID containing the CFT virtual network used by the Web PubSub private endpoint."
  type        = string
}

variable "web_pubsub_owner_ids" {
  description = "User or service principal object IDs granted Web PubSub Service Owner outside production."
  type        = list(string)
  default     = []
}

variable "private_dns_subscription_id" {
  type        = string
  default     = "1baf5470-1c3e-40d3-a6f7-74bfbce4b348"
  description = "Subscription containing the shared HMCTS private DNS zones."
}

variable "managed_redis_sku_name" {
  type        = string
  default     = "Balanced_B1"
  description = "Azure Managed Redis SKU. B1 preserves the default C1 cache's 1 GB; environment overrides match larger caches."
}

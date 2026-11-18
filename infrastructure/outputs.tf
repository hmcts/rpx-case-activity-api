output "rpx-case-activity-api-redis-host" {
  value = data.azurerm_managed_redis.connection.hostname
}

output "rpx-case-activity-api-redis-port" {
  value = data.azurerm_managed_redis.connection.default_database[0].port
}

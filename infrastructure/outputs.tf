output "rpx-case-activity-api-redis-host" {
  value = module.redis-activity-service.host_name
}

output "rpx-case-activity-api-redis-port" {
  value = module.redis-activity-service.redis_port
}

output "rpx-case-activity-api-managed-redis-host" {
  description = "Managed Redis hostname when the side-by-side instance is enabled."
  value       = try(one(values(module.managed-redis-activity-service)).hostname, null)
}

output "rpx-case-activity-api-managed-redis-port" {
  description = "Managed Redis TLS port when the side-by-side instance is enabled."
  value       = try(one(values(module.managed-redis-activity-service)).port, null)
}

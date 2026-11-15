variable "cloudflare_api_token" {
  description = "Cloudflare API token for staging Access management"
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
  default     = "b10e02a0d49aa9fd57d366ccf73242ed"
}

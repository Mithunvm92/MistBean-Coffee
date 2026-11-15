resource "cloudflare_zero_trust_access_application" "admin_staging" {
  account_id = var.account_id

  name   = "admin-staging"
  type   = "self_hosted"
  domain = "*.admin-staging.mistbeancoffee.in/api/admin/*"

  destinations = [
    {
      type = "public"
      uri  = "*.admin-staging.mistbeancoffee.in/api/admin/*"
    },
    {
      type = "public"
      uri  = "*.admin-staging.mistbeancoffee.in/admin/*"
    },
    {
      type = "public"
      uri  = "admin-staging.mistbeancoffee.in/api/admin/*"
    },
    {
      type = "public"
      uri  = "admin-staging.mistbeancoffee.in/admin/*"
    }
  ]

  policies = [
    {
      id         = "fd12d4e4-2d49-4a98-9ce7-b4fc416efe53"
      precedence = 1
    }
  ]

  session_duration           = "24h"
  app_launcher_visible       = true
  auto_redirect_to_identity  = false
  enable_binding_cookie      = false
  http_only_cookie_attribute = false
  options_preflight_bypass   = false
}

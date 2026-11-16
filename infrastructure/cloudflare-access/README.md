# Cloudflare Staging Access — Terraform

This configuration manages the **existing** Cloudflare Zero Trust Access application
`admin-staging` only. It does not manage the Worker-level Access application or
production resources.

## Managed resource

- Account ID: `b10e02a0d49aa9fd57d366ccf73242ed`
- Access application: `admin-staging`
- Application ID: `52bc9d38-18fc-4113-b2d9-8caa2ca6dd94`
- Destinations:
  - `*.admin-staging.mistbeancoffee.in/api/admin/*`
  - `*.admin-staging.mistbeancoffee.in/admin/*`
- Existing policy ID: `fd12d4e4-2d49-4a98-9ce7-b4fc416efe53`

## Local use

Run commands from this directory. Provide the API token through the environment;
never put it in a `.tfvars` file or commit it.

```bash
export TF_VAR_cloudflare_api_token="$CLOUDFLARE_API_TOKEN"
terraform init
terraform validate
terraform plan
```

The application was imported into the original developer's local state. New
clones have no state and must import the existing application before planning:

```bash
terraform import cloudflare_zero_trust_access_application.admin_staging \
  "accounts/b10e02a0d49aa9fd57d366ccf73242ed/52bc9d38-18fc-4113-b2d9-8caa2ca6dd94"
terraform plan
```

## GitHub Actions

Add a repository Actions secret named `CLOUDFLARE_API_TOKEN`. Use a Cloudflare
API token scoped to this account with **Cloudflare One / Zero Trust → Access:
Apps and Policies → Read + Edit**.

The workflow runs Terraform formatting, initialization, validation, imports the
existing app into its temporary runner state, and creates a read-only plan.
It intentionally contains **no `terraform apply` step**.

## State and safety

- Terraform state and plan files are ignored by Git.
- Do not commit `.tfstate`, `.tfplan`, `.tfvars`, API tokens, JWTs, or cookies.
- The GitHub Actions runner uses temporary local state; it does not persist state.
- Review every plan. Any apply must be a separate, explicitly approved operation.

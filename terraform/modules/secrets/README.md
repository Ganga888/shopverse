# `secrets` module

Environment application secrets and the CMK that encrypts all `shopverse/<env>/*` secrets.

- **`shopverse/<env>/auth/jwt`**: RS256 keypair from `tls_private_key` (`private_key` is PKCS#8 PEM, `public_key` is PEM).
  The private key is also stored in Terraform state, which is KMS-encrypted and access-controlled. To rotate it, `terraform apply -replace=module.secrets.tls_private_key.jwt`.
- **`shopverse/<env>/payment/gateway`**: placeholder `{"api_key": ...}`. `ignore_changes` keeps the real value, which you set out of band:
  `aws secretsmanager put-secret-value --secret-id shopverse/<env>/payment/gateway --secret-string '{"api_key":"..."}'`.

## Usage

```hcl
module "secrets" {
  source      = "../../modules/secrets"
  name_prefix = "shopverse-dev"
  environment = "dev"
}
```

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `name_prefix` | `string` | yes | shopverse-<env> |
| `environment` | `string` | yes |  |
| `recovery_window_in_days` | `number` | no | Secrets Manager deletion recovery window (0 = force delete, handy for dev). |
| `jwt_rsa_bits` | `number` | no | RSA key size for the RS256 JWT signing key. |
| `tags` | `map(string)` | no |  |

## Outputs

| Name | Description |
|---|---|
| `kms_key_arn` | CMK for shopverse/<env>/* secrets. |
| `jwt_secret_arn` |  |
| `jwt_public_key_pem` |  |
| `payment_gateway_secret_arn` |  |

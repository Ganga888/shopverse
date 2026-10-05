output "vault_arn" {
  value = aws_backup_vault.this.arn
}

output "dr_vault_arn" {
  value = try(aws_backup_vault.dr[0].arn, null)
}

output "plan_id" {
  value = aws_backup_plan.this.id
}

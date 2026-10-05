region        = "ap-south-1"
root_domain   = "ganga888.in"
instance_type = "t3.xlarge"

# REQUIRED: your public IP(s), e.g. ["203.0.113.25/32"]. Max 4 entries (ALB rule limit).
admin_cidrs = ["203.0.113.25/32"]

# Stop the host 21:00-08:00 IST and at weekends (~60% cheaper). Builds queue until it is back.
office_hours_schedule = false

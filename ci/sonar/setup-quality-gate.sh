#!/usr/bin/env bash
# Create/refresh the "shopverse-gate" quality gate and make it the default.
set -euo pipefail
: "${SONAR_HOST_URL:?}" "${SONAR_ADMIN_TOKEN:?}"
GATE=shopverse-gate
api() { curl -fsS -u "${SONAR_ADMIN_TOKEN}:" "$@"; }

if ! api "${SONAR_HOST_URL}/api/qualitygates/show?name=${GATE}" >/dev/null 2>&1; then
  api -X POST "${SONAR_HOST_URL}/api/qualitygates/create" --data-urlencode "name=${GATE}" >/dev/null
fi

# Remove existing conditions so the script is idempotent.
for id in $(api "${SONAR_HOST_URL}/api/qualitygates/show?name=${GATE}" | jq -r '.conditions[]?.id'); do
  api -X POST "${SONAR_HOST_URL}/api/qualitygates/delete_condition" -d "id=${id}" >/dev/null
done

add() { api -X POST "${SONAR_HOST_URL}/api/qualitygates/create_condition" \
  --data-urlencode "gateName=${GATE}" -d "metric=$1" -d "op=$2" -d "error=$3" >/dev/null; echo "  $1 $2 $3"; }
echo "conditions for ${GATE}:"
add new_coverage                    LT 70
add new_duplicated_lines_density    GT 3
add new_reliability_rating          GT 1
add new_security_rating             GT 1
add new_security_hotspots_reviewed  LT 100
add new_maintainability_rating      GT 1

api -X POST "${SONAR_HOST_URL}/api/qualitygates/set_as_default" --data-urlencode "name=${GATE}" >/dev/null
echo "${GATE} is the default quality gate"

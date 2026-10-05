#!/usr/bin/env bash
# Shell end-to-end smoke test (curl + jq) for the local compose stack or any environment:
#   BASE_URL=http://localhost:8080 ./scripts/e2e-smoke.sh
# Exercises register/login, catalog, search, cart + coupon, the order saga happy path and the tok_fail
# compensation path, shipping, notifications, reviews, recommendations and presigned media uploads.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:8080}"
API="$BASE_URL/api/v1"
pass=0
ok() { pass=$((pass + 1)); echo "  ok  $*"; }
die() { echo "FAIL  $*" >&2; exit 1; }
req() { # method path [json] -> body; sets $CODE
  local m=$1 p=$2 d=${3:-}
  local out
  out=$(curl -sS -m 15 -X "$m" "$API$p" ${d:+-H "content-type: application/json"} ${TOKEN:+-H "authorization: Bearer $TOKEN"} \
        ${IDEM:+-H "idempotency-key: $IDEM"} ${d:+-d "$d"} -w $'\n%{http_code}')
  CODE=${out##*$'\n'}; BODY=${out%$'\n'*}
}
expect() { [[ "$CODE" == "$1" ]] || die "$2: expected HTTP $1, got $CODE: $BODY"; ok "$2 ($CODE)"; }
poll() { # path jq-condition description
  for _ in $(seq 1 40); do req GET "$1"; if [[ "$CODE" == 200 ]] && jq -e "$2" >/dev/null <<<"$BODY"; then ok "$3"; return; fi; sleep 1; done
  die "$3: condition '$2' not met: $BODY"
}

EMAIL="e2e-$(date +%s)-$RANDOM@example.com"; PASS='E2eTest12345'; TOKEN=''
ADDR='{"name":"E2E","line1":"1 MG Road","city":"Bengaluru","state":"KA","postalCode":"560001","country":"IN"}'

echo "== auth"
req POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"E2E\"}"; expect 201 register
USER_ID=$(jq -r .userId <<<"$BODY")
req POST /auth/register "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"E2E\"}"; expect 409 "duplicate register"
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"nope-1234\"}"; expect 401 "bad password"
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"; expect 200 login
TOKEN=$(jq -r .accessToken <<<"$BODY"); REFRESH=$(jq -r .refreshToken <<<"$BODY")
req GET /auth/me; expect 200 me
req GET /users/me; expect 200 "user profile"

echo "== catalog / search / inventory"
req GET "/products?limit=20"; expect 200 "list products"
P1=$(jq -r '[.items[] | select(.priceCents % 100 != 13)][0].id' <<<"$BODY"); P2=$(jq -r '[.items[] | select(.priceCents % 100 != 13)][1].id' <<<"$BODY")
NAME=$(jq -r --arg id "$P1" '.items[] | select(.id==$id) | .name' <<<"$BODY")
req GET "/products/$P1"; expect 200 "get product"
poll "/search?q=$(cut -d' ' -f1 <<<"$NAME")" ".items | map(.productId) | index(\"$P1\") != null" "search indexed product"
req GET "/inventory/$P1"; expect 200 "stock"

echo "== cart + coupon"
req DELETE /cart; expect 204 "clear cart"
req POST /cart/items "{\"productId\":\"$P1\",\"quantity\":1}"; expect 201 "add item 1"
req POST /cart/items "{\"productId\":\"$P2\",\"quantity\":2}"; expect 201 "add item 2"
req POST /cart/coupon '{"code":"NOPE"}'; expect 422 "invalid coupon"
req POST /cart/coupon '{"code":"welcome10"}'; expect 200 "apply WELCOME10"
jq -e '.discountCents > 0 and .totalCents == .subtotalCents - .discountCents' >/dev/null <<<"$BODY" || die "discount not applied: $BODY"; ok "discount applied"

echo "== order saga: happy path"
ORDER="{\"items\":[{\"productId\":\"$P1\",\"quantity\":1},{\"productId\":\"$P2\",\"quantity\":2}],\"couponCode\":\"WELCOME10\",\"paymentToken\":\"tok_visa\",\"shippingAddress\":$ADDR}"
IDEM=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
req POST /orders "$ORDER"; expect 202 "create order"; OID=$(jq -r .orderId <<<"$BODY")
req POST /orders "$ORDER"; expect 200 "idempotent replay"; [[ $(jq -r .orderId <<<"$BODY") == "$OID" ]] || die "replay returned another order"
IDEM=''
poll "/orders/$OID" '.status == "CONFIRMED" and .saga.status == "COMPLETED"' "order CONFIRMED"
req GET "/payments/orders/$OID"; expect 200 payment; [[ $(jq -r .status <<<"$BODY") == AUTHORIZED ]] || die "payment not authorized"
poll "/shipping/orders/$OID" '.status == "CREATED"' "shipment created"
poll /cart '.items | length == 0' "cart cleared"
poll /notifications '.items | map(.kind) | index("order_confirmed") != null' "notification delivered"
poll "/recommendations/products/$P1" ".items | map(.productId) | index(\"$P2\") != null" "co-purchase recommendation"

echo "== order saga: payment failure -> compensation"
req GET "/inventory/$P1"; BEFORE=$(jq -r .available <<<"$BODY")
IDEM=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)
req POST /orders "{\"items\":[{\"productId\":\"$P1\",\"quantity\":1}],\"paymentToken\":\"tok_fail\",\"shippingAddress\":$ADDR}"; expect 202 "create failing order"
IDEM=''; FOID=$(jq -r .orderId <<<"$BODY")
poll "/orders/$FOID" '.status == "CANCELLED" and .failureReason == "card_declined" and .saga.status == "COMPENSATED"' "order CANCELLED"
poll "/inventory/$P1" ".available == $BEFORE" "stock released"
req GET "/shipping/orders/$FOID"; expect 404 "no shipment for cancelled order"

echo "== reviews / media"
req POST /reviews "{\"productId\":\"$P1\",\"rating\":5,\"title\":\"Great\"}"; expect 201 "create review"
req POST /reviews "{\"productId\":\"$P1\",\"rating\":4,\"title\":\"Again\"}"; expect 409 "duplicate review"
req GET "/reviews?productId=$P1"; expect 200 "list reviews"
req POST /media/uploads '{"filename":"photo.jpg","contentType":"image/jpeg","contentLength":1000}'; expect 201 "presigned upload"
jq -e --arg u "$USER_ID" '(.uploadUrl | contains("X-Amz-Signature")) and (.key | startswith("users/" + $u + "/"))' >/dev/null <<<"$BODY" || die "bad presign: $BODY"; ok "presigned url scoped to user"

echo "== logout"
TOKEN=''
req POST /auth/logout "{\"refreshToken\":\"$REFRESH\"}"; expect 204 logout
req POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"; expect 401 "refresh after logout"
echo "PASSED: $pass checks against $BASE_URL"

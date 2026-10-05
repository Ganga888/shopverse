#!/usr/bin/env bash
# Create ShopVerse Kafka topics (+ .dlq) idempotently.
#   BOOTSTRAP=kafka:9092 PARTITIONS=3 REPLICATION=1 ./create-topics.sh
# Optional: COMMAND_CONFIG=/path/client.properties for TLS/SASL (MSK).
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-localhost:9092}"
PARTITIONS="${PARTITIONS:-3}"
REPLICATION="${REPLICATION:-1}"
MIN_ISR="${MIN_ISR:-1}"
KAFKA_BIN="${KAFKA_BIN:-/opt/kafka/bin}"
EXTRA=()
[[ -n "${COMMAND_CONFIG:-}" ]] && EXTRA=(--command-config "$COMMAND_CONFIG")

TOPICS=(
  users.events
  catalog.events
  orders.events
  inventory.commands
  inventory.events
  payments.commands
  payments.events
  shipping.events
  reviews.events
)

for i in $(seq 1 30); do
  if "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" "${EXTRA[@]}" --list >/dev/null 2>&1; then break; fi
  echo "waiting for kafka at $BOOTSTRAP ($i/30)"; sleep 2
done

for t in "${TOPICS[@]}"; do
  for name in "$t" "$t.dlq"; do
    retention=604800000 # 7 days
    [[ "$name" == *.dlq ]] && retention=1209600000 # 14 days
    "$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" "${EXTRA[@]}" --create --if-not-exists \
      --topic "$name" --partitions "$PARTITIONS" --replication-factor "$REPLICATION" \
      --config min.insync.replicas="$MIN_ISR" --config retention.ms="$retention"
  done
done
"$KAFKA_BIN/kafka-topics.sh" --bootstrap-server "$BOOTSTRAP" "${EXTRA[@]}" --list

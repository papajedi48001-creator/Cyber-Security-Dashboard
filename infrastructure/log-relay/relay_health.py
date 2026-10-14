#!/usr/bin/env python3
"""Report TLS Log Relay forwarding health from `syslog-ng-ctl stats` output.

Exit codes: 0 healthy, 1 degraded, 2 failed, 3 unknown. Prints one JSON line,
which a monitoring agent (or the Portal source-health check) can collect.

Usage: syslog-ng-ctl stats | relay_health.py --stats-file - [--queued-warn 1000]
"""
import argparse
import json
import sys

DESTINATION_ID = "d_wazuh#0"
EXIT_CODES = {"healthy": 0, "degraded": 1, "failed": 2, "unknown": 3}


def evaluate(stats_text, queued_warn):
    counters = {}
    for line in stats_text.splitlines():
        parts = line.strip().split(";")
        if len(parts) != 6 or parts[1] != DESTINATION_ID:
            continue
        try:
            counters[parts[4]] = int(parts[5])
        except ValueError:
            continue
    if "queued" not in counters and "dropped" not in counters:
        return {"status": "unknown", "reason": "wazuh destination not found in stats"}
    queued = counters.get("queued", 0)
    dropped = counters.get("dropped", 0)
    result = {"queued": queued, "dropped": dropped, "written": counters.get("written")}
    if dropped > 0:
        result.update(status="failed", reason="events dropped before reaching Wazuh")
    elif queued >= queued_warn:
        result.update(status="degraded", reason="events buffered; Wazuh not keeping up or unreachable")
    else:
        result.update(status="healthy")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stats-file", default="-")
    parser.add_argument("--queued-warn", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.stats_file == "-":
        text = sys.stdin.read()
    else:
        with open(args.stats_file, encoding="utf-8") as handle:
            text = handle.read()
    result = evaluate(text, args.queued_warn)
    print(json.dumps(result, sort_keys=True))
    return EXIT_CODES[result["status"]]


if __name__ == "__main__":
    sys.exit(main())

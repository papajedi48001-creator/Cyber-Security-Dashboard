#!/usr/bin/env python3
"""Run the synthetic fixtures through the real Wazuh ruleset via the logtest socket.

Run on the Wazuh server (as root or the wazuh group) after installing the
decoders and rules:
  python3 logtest_check.py [--socket /var/ossec/queue/sockets/logtest]

Exit code 0 when every fixture raises exactly its expected category.
"""
import argparse
import json
import pathlib
import socket
import struct
import sys

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_SOCKET = "/var/ossec/queue/sockets/logtest"
CATEGORIES = {
    "blocked_traffic",
    "admin_or_login_failure",
    "firewall_rule_change",
    "vpn_anomaly",
    "ips_av_web_event",
    "log_source_health",
}
SYSLOG_HEADER = "Oct 14 10:00:00 sophos-fw "


def frame(payload):
    body = json.dumps(payload).encode()
    return struct.pack("<I", len(body)) + body


def _recv_exact(sock, size):
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionError("logtest socket closed")
        data += chunk
    return data


def request(socket_path, event, log_format, token=None):
    params = {"event": event, "log_format": log_format, "location": "logtest_check"}
    if token:
        params["token"] = token
    payload = {
        "version": 1,
        "origin": {"name": "logtest_check", "module": "logtest"},
        "command": "log_processing",
        "parameters": params,
    }
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
        sock.connect(socket_path)
        sock.sendall(frame(payload))
        (length,) = struct.unpack("<I", _recv_exact(sock, 4))
        response = json.loads(_recv_exact(sock, length))
    if response.get("error"):
        raise RuntimeError(f"logtest error: {response}")
    return response["data"]


def category(data):
    output = data.get("output", {})
    rule = output.get("rule")
    if not rule or int(rule.get("level", 0)) < 3:
        return None, rule
    found = [g for g in rule.get("groups", []) if g in CATEGORIES]
    return (found[0] if len(found) == 1 else f"ambiguous:{found}"), rule


def run(socket_path, fixtures):
    cases = [(c["name"], SYSLOG_HEADER + c["log"], "syslog", c["expect"]) for c in fixtures["events"]]
    cases += [(c["name"], json.dumps(c["log"]), "json", c["expect"]) for c in fixtures["relay_health"]]
    failures = 0
    token = None
    for name, event, log_format, expected in cases:
        data = request(socket_path, event, log_format, token)
        token = data.get("token", token)
        got, rule = category(data)
        ok = got == expected
        failures += not ok
        rule_id = rule.get("id") if rule else "-"
        print(f"{'PASS' if ok else 'FAIL'}  {name}: expected={expected} got={got} rule={rule_id}")
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", default=DEFAULT_SOCKET)
    parser.add_argument("--fixtures", default=str(HERE / "tests/fixtures/sophos_events.json"))
    args = parser.parse_args(argv)
    fixtures = json.loads(pathlib.Path(args.fixtures).read_text())
    failures = run(args.socket, fixtures)
    print(f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Convert an nmap XML report into the Portal's External Exposure Scan summary.

Only public target addresses and open ports leave the scanner: no banners,
script output, OS guesses or hostnames (ADR 0007).

Usage: python3 nmap_to_summary.py --targets targets.txt scan.xml > summary.json
"""
import argparse
import ipaddress
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

FORMAT = "external-exposure-scan/v1"
SERVICE = re.compile(r"^[A-Za-z0-9._/-]{1,64}$")


# Same list as the Portal importer: addresses never reachable from the Internet.
INTERNAL = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10",
    "::1/128", "fc00::/7", "fe80::/10",
)]


class SummaryError(ValueError):
    pass


def load_targets(text):
    targets = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        address = ipaddress.ip_address(line)
        if any(address in net for net in INTERNAL if net.version == address.version):
            raise SummaryError(f"target {line} is not a public address")
        targets.append(str(address))
    if not targets:
        raise SummaryError("no targets")
    return targets


def _time(epoch):
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def summarize(xml_text, targets):
    root = ET.fromstring(xml_text)
    if root.tag != "nmaprun":
        raise SummaryError("not an nmap XML report")
    finished = root.find("runstats/finished")
    if finished is None or finished.get("exit") != "success":
        raise SummaryError("nmap run did not finish successfully")
    allowed = set(targets)
    findings = []
    for host in root.findall("host"):
        addr = host.find("address[@addrtype='ipv4']")
        if addr is None:
            addr = host.find("address[@addrtype='ipv6']")
        if addr is None:
            continue
        address = str(ipaddress.ip_address(addr.get("addr")))
        if address not in allowed:
            raise SummaryError(f"host {address} is not in the approved target list")
        for port in host.findall("ports/port"):
            state = port.find("state")
            if state is None or state.get("state") != "open":
                continue
            service = port.find("service")
            name = service.get("name") if service is not None else None
            findings.append({
                "address": address,
                "port": int(port.get("portid")),
                "protocol": port.get("protocol", "tcp").upper(),
                "service": name if name and SERVICE.match(name) else None,
            })
    findings.sort(key=lambda f: (f["address"], f["protocol"], f["port"]))
    return {
        "format": FORMAT,
        "scanner": f"nmap {root.get('version', '')}".strip(),
        "startedAt": _time(root.get("start")),
        "finishedAt": _time(finished.get("time")),
        "targets": targets,
        "findings": findings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--targets", required=True, help="approved public addresses, one per line")
    parser.add_argument("report", help="nmap -oX output")
    args = parser.parse_args(argv)
    try:
        targets = load_targets(pathlib.Path(args.targets).read_text())
        summary = summarize(pathlib.Path(args.report).read_text(), targets)
    except (SummaryError, ValueError, ET.ParseError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    json.dump(summary, sys.stdout, indent=2)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

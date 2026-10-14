#!/usr/bin/env python3
"""Render syslog-ng.conf for the TLS Log Relay from the template and allowlist.

Usage:
  render_config.py --allowed-sources allowed-sources --listen-ip 10.1.1.10 \
      --wazuh-host 10.1.1.20 [--wazuh-port 514] [--buffer-size-mb 2048] \
      [--tls-dir /etc/syslog-ng/tls] [--state-dir /var/lib/syslog-ng] > syslog-ng.conf
"""
import argparse
import ipaddress
import pathlib
import sys

MIN_PREFIX_V4 = 24
MIN_PREFIX_V6 = 64
MAX_BUFFER_MB = 100 * 1024  # 100 GiB


def parse_allowed_sources(text):
    """Return normalised CIDRs; reject wildcards, broad networks and bad entries."""
    networks = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if "*" in line:
            raise ValueError(f"wildcard sender not allowed: {line}")
        try:
            network = ipaddress.ip_network(line, strict=False)
        except ValueError as exc:
            raise ValueError(f"invalid sender address: {line}") from exc
        if network.network_address.is_unspecified:
            raise ValueError(f"wildcard sender not allowed: {line}")
        min_prefix = MIN_PREFIX_V4 if network.version == 4 else MIN_PREFIX_V6
        if network.prefixlen < min_prefix:
            raise ValueError(f"sender network too broad (/{network.prefixlen}): {line}")
        networks.append(str(network))
    if not networks:
        raise ValueError("allowed sources list is empty")
    return networks


def _buffer_bytes(size_mb):
    try:
        size = int(size_mb)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"buffer size must be an integer number of MB: {size_mb}") from exc
    if not 1 <= size <= MAX_BUFFER_MB:
        raise ValueError(f"buffer size must be between 1 and {MAX_BUFFER_MB} MB: {size}")
    return size * 1024 * 1024


def render(template, allowed_sources_text, *, listen_ip, wazuh_host, wazuh_port="514", buffer_size_mb="2048",
           tls_dir="/etc/syslog-ng/tls", state_dir="/var/lib/syslog-ng"):
    networks = parse_allowed_sources(allowed_sources_text)
    ipaddress.ip_address(listen_ip)
    ipaddress.ip_address(wazuh_host)
    port = int(wazuh_port)
    if not 1 <= port <= 65535:
        raise ValueError(f"invalid Wazuh port: {wazuh_port}")
    source_filter = "\n  or ".join(f'netmask("{n}")' for n in networks)
    values = {
        "LISTEN_IP": listen_ip,
        "WAZUH_HOST": wazuh_host,
        "WAZUH_PORT": str(port),
        "BUFFER_BYTES": str(_buffer_bytes(buffer_size_mb)),
        "ALLOWED_SOURCES_FILTER": f"  {source_filter};",
        "TLS_DIR": tls_dir.rstrip("/"),
        "STATE_DIR": state_dir.rstrip("/"),
    }
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    if "{{" in rendered:
        raise ValueError("template has unrendered placeholders")
    return rendered


def main(argv=None):
    here = pathlib.Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", default=str(here / "syslog-ng.conf.template"))
    parser.add_argument("--allowed-sources", required=True)
    parser.add_argument("--listen-ip", required=True)
    parser.add_argument("--wazuh-host", required=True)
    parser.add_argument("--wazuh-port", default="514")
    parser.add_argument("--buffer-size-mb", default="2048")
    parser.add_argument("--tls-dir", default="/etc/syslog-ng/tls")
    parser.add_argument("--state-dir", default="/var/lib/syslog-ng")
    args = parser.parse_args(argv)
    try:
        sys.stdout.write(render(
            pathlib.Path(args.template).read_text(),
            pathlib.Path(args.allowed_sources).read_text(),
            listen_ip=args.listen_ip,
            wazuh_host=args.wazuh_host,
            wazuh_port=args.wazuh_port,
            buffer_size_mb=args.buffer_size_mb,
            tls_dir=args.tls_dir,
            state_dir=args.state_dir,
        ))
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

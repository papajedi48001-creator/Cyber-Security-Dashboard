"""Tests for the nmap XML to Portal summary converter.

Run: python3 -m unittest discover -s infrastructure/external-scan/tests
"""
import json
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import nmap_to_summary as conv  # noqa: E402

REPORT = """<?xml version="1.0"?>
<nmaprun scanner="nmap" version="7.95" start="1791939000">
  <host>
    <status state="up"/>
    <address addr="203.0.113.10" addrtype="ipv4"/>
    <hostnames><hostname name="www.hospital.example"/></hostnames>
    <ports>
      <port protocol="tcp" portid="443"><state state="open"/><service name="https" product="nginx" version="1.25"/>
        <script id="ssl-cert" output="secret-ish banner"/></port>
      <port protocol="tcp" portid="3389"><state state="open"/><service name="ms-wbt-server"/></port>
      <port protocol="tcp" portid="22"><state state="filtered"/><service name="ssh"/></port>
    </ports>
    <os><osmatch name="Linux 5.x"/></os>
  </host>
  <host>
    <status state="up"/>
    <address addr="203.0.113.11" addrtype="ipv4"/>
    <ports/>
  </host>
  <runstats><finished time="1791939600" exit="success"/></runstats>
</nmaprun>
"""

TARGETS = ["203.0.113.10", "203.0.113.11"]


class SummaryTests(unittest.TestCase):
    def test_keeps_only_open_ports_and_reference_fields(self):
        summary = conv.summarize(REPORT, TARGETS)
        self.assertEqual(summary["format"], "external-exposure-scan/v1")
        self.assertEqual(summary["scanner"], "nmap 7.95")
        self.assertEqual(summary["finishedAt"], "2026-10-14T01:00:00Z")
        self.assertEqual(
            summary["findings"],
            [
                {"address": "203.0.113.10", "port": 443, "protocol": "TCP", "service": "https"},
                {"address": "203.0.113.10", "port": 3389, "protocol": "TCP", "service": "ms-wbt-server"},
            ],
        )
        text = json.dumps(summary)
        for leak in ("nginx", "banner", "Linux", "www.hospital.example"):
            self.assertNotIn(leak, text)

    def test_rejects_hosts_outside_the_approved_targets(self):
        with self.assertRaises(conv.SummaryError):
            conv.summarize(REPORT, ["203.0.113.10"])

    def test_rejects_an_unfinished_scan(self):
        with self.assertRaises(conv.SummaryError):
            conv.summarize(REPORT.replace('exit="success"', 'exit="error"'), TARGETS)

    def test_targets_must_be_public(self):
        with self.assertRaises(conv.SummaryError):
            conv.load_targets("10.0.0.1\n")
        with self.assertRaises(conv.SummaryError):
            conv.load_targets("# only comments\n")
        with self.assertRaises(conv.SummaryError):
            conv.load_targets("192.168.1.5\n")
        self.assertEqual(conv.load_targets("203.0.113.10  # web\n"), ["203.0.113.10"])

    def test_example_targets_file_is_valid(self):
        self.assertEqual(conv.load_targets((HERE.parent / "targets.example").read_text()), TARGETS)

    def test_cli_writes_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = pathlib.Path(tmp, "scan.xml")
            report.write_text(REPORT)
            targets = pathlib.Path(tmp, "targets.txt")
            targets.write_text("\n".join(TARGETS))
            self.assertEqual(conv.main(["--targets", str(targets), str(report)]), 0)


if __name__ == "__main__":
    unittest.main()

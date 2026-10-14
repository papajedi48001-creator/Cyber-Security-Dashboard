"""Tests for the TLS Log Relay template, renderer and health check.

Run: python3 -m unittest discover -s infrastructure/log-relay/tests
"""
import json
import pathlib
import subprocess
import sys
import unittest

RELAY_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RELAY_DIR))

import render_config  # noqa: E402
import relay_health  # noqa: E402

TEMPLATE = (RELAY_DIR / "syslog-ng.conf.template").read_text()
EXAMPLE_SOURCES = (RELAY_DIR / "allowed-sources.example").read_text()


def render(sources=EXAMPLE_SOURCES, **overrides):
    params = {
        "listen_ip": "192.0.2.10",
        "wazuh_host": "192.0.2.20",
        "wazuh_port": "514",
        "buffer_size_mb": "2048",
    }
    params.update(overrides)
    return render_config.render(TEMPLATE, sources, **params)


class TemplateTests(unittest.TestCase):
    def test_listener_requires_tls_with_trusted_peer(self):
        config = render()
        self.assertIn('transport("tls")', config)
        self.assertIn("peer-verify(required-trusted)", config)

    def test_has_no_plain_udp_or_tcp_listener(self):
        source_block = render().split("destination")[0]
        self.assertNotIn('transport("udp")', source_block)
        self.assertNotIn('transport("tcp")', source_block)

    def test_forwarding_uses_finite_reliable_disk_buffer(self):
        config = render(buffer_size_mb="512")
        self.assertIn("disk-buffer(", config)
        self.assertIn("reliable(yes)", config)
        self.assertIn(f"disk-buf-size({512 * 1024 * 1024})", config)

    def test_only_allowed_sources_reach_wazuh(self):
        config = render("198.51.100.1\n198.51.100.0/30\n")
        self.assertIn('netmask("198.51.100.1/32")', config)
        self.assertIn('netmask("198.51.100.0/30")', config)
        self.assertIn("filter(f_allowed_sources)", config)

    def test_rejected_senders_are_logged_for_evidence(self):
        config = render()
        self.assertIn("not filter(f_allowed_sources)", config)
        self.assertIn("rejected-senders.log", config)

    def test_no_placeholder_left_after_render(self):
        self.assertNotIn("{{", render())


class AllowedSourcesTests(unittest.TestCase):
    def test_comments_and_blank_lines_are_ignored(self):
        self.assertEqual(
            render_config.parse_allowed_sources("# Sophos\n\n198.51.100.1\n"),
            ["198.51.100.1/32"],
        )

    def test_wildcard_sources_are_rejected(self):
        for wildcard in ("0.0.0.0/0", "::/0", "*", "0.0.0.0"):
            with self.subTest(wildcard=wildcard):
                with self.assertRaises(ValueError):
                    render_config.parse_allowed_sources(wildcard)

    def test_overly_broad_network_is_rejected(self):
        with self.assertRaises(ValueError):
            render_config.parse_allowed_sources("10.0.0.0/8")

    def test_invalid_address_is_rejected(self):
        with self.assertRaises(ValueError):
            render_config.parse_allowed_sources("sophos.example")

    def test_empty_allowlist_is_rejected(self):
        with self.assertRaises(ValueError):
            render_config.parse_allowed_sources("# nothing\n")

    def test_example_file_is_valid_documentation_range(self):
        for network in render_config.parse_allowed_sources(EXAMPLE_SOURCES):
            self.assertTrue(network.startswith(("192.0.2.", "198.51.100.", "203.0.113.")))

    def test_buffer_size_must_be_bounded(self):
        for size in ("0", "-1", "999999", "abc"):
            with self.subTest(size=size):
                with self.assertRaises(ValueError):
                    render(buffer_size_mb=size)


STATS_OK = """SourceName;SourceId;SourceInstance;State;Type;Number
src.network;s_sophos_tls#0;afsocket_sd.(stream,AF_INET(192.0.2.10:6514));a;processed;1200
dst.network;d_wazuh#0;tcp,192.0.2.20:514;a;processed;1200
dst.network;d_wazuh#0;tcp,192.0.2.20:514;a;written;1200
dst.network;d_wazuh#0;tcp,192.0.2.20:514;a;queued;0
dst.network;d_wazuh#0;tcp,192.0.2.20:514;a;dropped;0
"""


class HealthTests(unittest.TestCase):
    def test_healthy_when_queue_empty_and_nothing_dropped(self):
        result = relay_health.evaluate(STATS_OK, queued_warn=1000)
        self.assertEqual(result["status"], "healthy")

    def test_degraded_when_events_queue_up(self):
        stats = STATS_OK.replace("queued;0", "queued;5000")
        result = relay_health.evaluate(stats, queued_warn=1000)
        self.assertEqual(result["status"], "degraded")
        self.assertEqual(result["queued"], 5000)

    def test_failed_when_events_dropped(self):
        stats = STATS_OK.replace("dropped;0", "dropped;3")
        result = relay_health.evaluate(stats, queued_warn=1000)
        self.assertEqual(result["status"], "failed")

    def test_unknown_when_wazuh_destination_missing(self):
        stats = "\n".join(STATS_OK.splitlines()[:2])
        result = relay_health.evaluate(stats, queued_warn=1000)
        self.assertEqual(result["status"], "unknown")

    def test_cli_exit_code_reflects_status(self):
        script = RELAY_DIR / "relay_health.py"
        for stats, code in ((STATS_OK, 0), (STATS_OK.replace("dropped;0", "dropped;1"), 2)):
            with self.subTest(code=code):
                proc = subprocess.run(
                    [sys.executable, str(script), "--stats-file", "-"],
                    input=stats, capture_output=True, text=True,
                )
                self.assertEqual(proc.returncode, code, proc.stderr)
                report = json.loads(proc.stdout)
                self.assertEqual(report["component"], "log_relay")
                self.assertIn("checked_at", report)


if __name__ == "__main__":
    unittest.main()

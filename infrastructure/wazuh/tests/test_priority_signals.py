"""Checks the Sophos decoders and priority-signal rules against synthetic events.

The simulator in ruleset_sim.py supports only the PCRE2 subset these files
use. It is a fast pre-check; the authoritative check is logtest_check.py run
against wazuh-logtest on the real Wazuh server.

Run: python3 -m unittest discover -s infrastructure/wazuh/tests
"""
import json
import pathlib
import sys
import unittest
import xml.etree.ElementTree as ET

WAZUH_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ruleset_sim  # noqa: E402

FIXTURES = json.loads((WAZUH_DIR / "tests/fixtures/sophos_events.json").read_text())
CATEGORIES = {
    "blocked_traffic",
    "admin_or_login_failure",
    "firewall_rule_change",
    "vpn_anomaly",
    "ips_av_web_event",
    "log_source_health",
    "restricted_egress",
}
CUSTOM_RULE_RANGE = range(100100, 100200)


def load():
    return ruleset_sim.Ruleset.load(
        sorted((WAZUH_DIR / "decoders").glob("*.xml")),
        sorted((WAZUH_DIR / "rules").glob("*.xml")),
    )


class RulesetFileTests(unittest.TestCase):
    def test_files_are_well_formed_xml(self):
        for path in [*(WAZUH_DIR / "decoders").glob("*.xml"), *(WAZUH_DIR / "rules").glob("*.xml")]:
            with self.subTest(path=path.name):
                ET.fromstring(f"<root>{path.read_text()}</root>")

    def test_rule_ids_are_unique_and_in_custom_range(self):
        ids = [rule.id for rule in load().rules]
        self.assertEqual(len(ids), len(set(ids)))
        for rule_id in ids:
            self.assertIn(rule_id, CUSTOM_RULE_RANGE)

    def test_alerting_rules_carry_one_category_or_are_heartbeats(self):
        for rule in load().rules:
            if rule.level < 3:
                continue
            categories = [g for g in rule.groups if g in CATEGORIES]
            with self.subTest(rule=rule.id):
                self.assertTrue(len(categories) == 1 or "log_relay_heartbeat" in rule.groups)

    def test_relay_heartbeat_alerts_without_category(self):
        result = load().process('{"component": "log_relay", "status": "healthy", "queued": 0, "dropped": 0}')
        self.assertEqual(result.rule.id, 100183)
        self.assertIn("log_relay_heartbeat", result.rule.groups)

    def test_every_priority_category_has_an_alerting_rule(self):
        covered = {g for rule in load().rules if rule.level >= 3 for g in rule.groups}
        self.assertTrue(CATEGORIES <= covered, CATEGORIES - covered)


class SophosEventTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ruleset = load()

    def test_each_event_raises_exactly_its_category(self):
        for case in FIXTURES["events"]:
            with self.subTest(case=case["name"]):
                result = self.ruleset.process(case["log"])
                self.assertEqual(result.decoder, "sophos-sfos")
                self.assertEqual(result.category(CATEGORIES), case["expect"], result)

    def test_decoder_extracts_fields_for_the_portal(self):
        result = self.ruleset.process(FIXTURES["events"][0]["log"])
        self.assertEqual(result.fields["srcip"], "203.0.113.50")
        self.assertEqual(result.fields["dstip"], "192.0.2.15")
        self.assertEqual(result.fields["dstport"], "3389")
        self.assertEqual(result.fields["log_type"], "Firewall")

    def test_each_category_is_covered_by_a_fixture(self):
        expected = {c["expect"] for c in FIXTURES["events"] + FIXTURES["relay_health"]}
        self.assertTrue(CATEGORIES <= expected)

    def test_non_sophos_line_is_not_decoded_as_sophos(self):
        result = self.ruleset.process("sshd[123]: Accepted publickey for test from 192.0.2.1")
        self.assertNotEqual(result.decoder, "sophos-sfos")
        self.assertIsNone(result.category(CATEGORIES))


class RelayHealthTests(unittest.TestCase):
    def test_relay_health_status_maps_to_source_health(self):
        ruleset = load()
        for case in FIXTURES["relay_health"]:
            with self.subTest(case=case["name"]):
                result = ruleset.process(json.dumps(case["log"]))
                self.assertEqual(result.decoder, "json")
                self.assertEqual(result.category(CATEGORIES), case["expect"], result)


class IndexLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads((WAZUH_DIR / "index-lifecycle-policy.example.json").read_text())["policy"]
        self.states = {s["name"]: s for s in self.policy["states"]}

    def _transition_age(self, state):
        return int(self.states[state]["transitions"][0]["conditions"]["min_index_age"].rstrip("d"))

    def test_hot_indices_stay_queryable_for_90_days(self):
        self.assertEqual(self.policy["default_state"], "hot")
        self.assertGreaterEqual(self._transition_age("hot"), 90)

    def test_snapshot_happens_before_delete(self):
        archive_actions = [list(a) for a in self.states["archive"]["actions"]]
        self.assertIn(["snapshot"], archive_actions)
        self.assertEqual(self.states["archive"]["transitions"][0]["state_name"], "delete")
        self.assertIn(["delete"], [list(a) for a in self.states["delete"]["actions"]])

    def test_policy_covers_alert_and_archive_indices(self):
        patterns = self.policy["ism_template"][0]["index_patterns"]
        self.assertIn("wazuh-alerts-*", patterns)
        self.assertIn("wazuh-archives-*", patterns)


if __name__ == "__main__":
    unittest.main()

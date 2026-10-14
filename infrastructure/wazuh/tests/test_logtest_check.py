"""Tests logtest_check.py's socket protocol against a fake logtest server."""
import json
import pathlib
import socket
import struct
import sys
import tempfile
import threading
import unittest

WAZUH_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WAZUH_DIR))
sys.path.insert(0, str(WAZUH_DIR / "tests"))

import logtest_check  # noqa: E402
import ruleset_sim  # noqa: E402


class FakeLogtest:
    """Answers logtest requests using the local simulator, like wazuh-logtest would."""

    def __init__(self, path):
        self.ruleset = ruleset_sim.Ruleset.load(
            sorted((WAZUH_DIR / "decoders").glob("*.xml")), sorted((WAZUH_DIR / "rules").glob("*.xml")))
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen()
        threading.Thread(target=self.serve, daemon=True).start()

    def serve(self):
        while True:
            try:
                conn, _ = self.server.accept()
            except OSError:
                return
            with conn:
                (length,) = struct.unpack("<I", conn.recv(4))
                body = b""
                while len(body) < length:
                    body += conn.recv(length - len(body))
                params = json.loads(body)["parameters"]
                event = params["event"]
                if params["log_format"] == "syslog":
                    event = event[len(logtest_check.SYSLOG_HEADER):]
                result = self.ruleset.process(event)
                output = {}
                if result.rule:
                    output["rule"] = {"id": str(result.rule.id), "level": result.rule.level,
                                      "groups": result.rule.groups}
                reply = json.dumps({"error": 0, "data": {"output": output, "token": "t1"}}).encode()
                conn.sendall(struct.pack("<I", len(reply)) + reply)


class LogtestCheckTests(unittest.TestCase):
    def test_frame_uses_little_endian_length_prefix(self):
        framed = logtest_check.frame({"a": 1})
        self.assertEqual(struct.unpack("<I", framed[:4])[0], len(framed) - 4)

    def test_all_fixtures_pass_through_socket_protocol(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = f"{tmp}/logtest"
            fake = FakeLogtest(path)
            fixtures = json.loads((WAZUH_DIR / "tests/fixtures/sophos_events.json").read_text())
            self.assertEqual(logtest_check.run(path, fixtures), 0)
            fake.server.close()

    def test_low_level_rule_is_not_a_category(self):
        self.assertEqual(logtest_check.category({"output": {"rule": {"level": 0, "groups": ["sophos"]}}}),
                         (None, {"level": 0, "groups": ["sophos"]}))


if __name__ == "__main__":
    unittest.main()

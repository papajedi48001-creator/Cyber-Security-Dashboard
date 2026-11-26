"""Static checks for the GDCC Portal database replica configuration (ADR 0009).

Run: python3 -m unittest discover -s infrastructure/gdcc-replica/tests
The end-to-end rehearsal is lab/run-lab.sh (needs MariaDB, sshd and autossh).
"""
import configparser
import ipaddress
import pathlib
import re
import unittest

DIR = pathlib.Path(__file__).resolve().parents[1]


def cnf(name):
    parser = configparser.ConfigParser(allow_no_value=True, strict=True)
    parser.read_string((DIR / name).read_text())
    return {k: (v or "").strip() for k, v in parser["mariadb"].items()}


class PrimaryTests(unittest.TestCase):
    def test_binary_log_is_durable_row_based_gtid(self):
        c = cnf("primary.cnf.example")
        self.assertEqual(c["binlog_format"], "ROW")
        self.assertEqual(c["gtid_strict_mode"], "ON")
        self.assertEqual(c["sync_binlog"], "1")
        self.assertIn("log_bin", c)
        self.assertGreaterEqual(int(c["binlog_expire_logs_seconds"]), 7 * 86400)

    def test_primary_serves_tls(self):
        c = cnf("primary.cnf.example")
        for key in ("ssl_ca", "ssl_cert", "ssl_key"):
            self.assertTrue(c[key].startswith("/"), key)


class ReplicaTests(unittest.TestCase):
    def test_replica_is_read_only_and_crash_safe(self):
        c = cnf("replica.cnf.example")
        self.assertEqual(c["read_only"], "ON")
        self.assertEqual(c["relay_log_recovery"], "ON")
        self.assertNotEqual(c["server_id"], cnf("primary.cnf.example")["server_id"])

    def test_replica_copies_only_the_portal_database_and_listens_locally(self):
        c = cnf("replica.cnf.example")
        self.assertEqual(c["replicate_do_db"], "portal")
        self.assertEqual(c["bind_address"], "127.0.0.1")


class SetupTests(unittest.TestCase):
    sql = (DIR / "setup-replica.sql.example").read_text()

    def test_replication_requires_verified_tls_and_gtid(self):
        self.assertRegex(self.sql, r"IDENTIFIED BY 'CHANGE_ME' REQUIRE SSL")
        self.assertIn("MASTER_SSL = 1", self.sql)
        self.assertIn("MASTER_SSL_VERIFY_SERVER_CERT = 1", self.sql)
        self.assertIn("MASTER_USE_GTID = slave_pos", self.sql)

    def test_accounts_have_least_privilege(self):
        self.assertIn("GRANT REPLICATION SLAVE ON *.* TO 'repl'", self.sql)
        self.assertIn("GRANT SLAVE MONITOR ON *.* TO 'portal-monitor'", self.sql)
        self.assertNotRegex(self.sql, r"GRANT ALL")

    def test_no_real_passwords(self):
        for password in re.findall(r"(?:IDENTIFIED BY|MASTER_PASSWORD =) '([^']*)'", self.sql):
            self.assertEqual(password, "CHANGE_ME")


class TunnelTests(unittest.TestCase):
    def test_tunnel_key_cannot_get_a_shell_or_other_ports(self):
        line = next(l for l in (DIR / "authorized_keys.example").read_text().splitlines() if l and not l.startswith("#"))
        options = line.split(" ")[0]
        for required in ("restrict", "port-forwarding", 'command="/bin/false"', 'permitlisten="127.0.0.1:13306"', 'permitopen="127.0.0.1:3306"'):
            self.assertIn(required, options)

    def test_tunnel_forwards_match_the_setup(self):
        unit = (DIR / "systemd/gdcc-replica-tunnel.service.example").read_text()
        self.assertIn("-R 127.0.0.1:13306:127.0.0.1:3306", unit)
        self.assertIn("-L 127.0.0.1:3316:127.0.0.1:3306", unit)
        self.assertIn("StrictHostKeyChecking=yes", unit)
        self.assertIn("ExitOnForwardFailure=yes", unit)


class NoRealAddressesTests(unittest.TestCase):
    def test_only_loopback_or_documentation_addresses(self):
        allowed = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24")]
        for path in DIR.rglob("*"):
            if path.is_file() and path.suffix != ".pyc":
                for match in re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", path.read_text(errors="ignore")):
                    address = ipaddress.ip_address(match)
                    self.assertTrue(any(address in n for n in allowed), f"{path.name}: {match}")


if __name__ == "__main__":
    unittest.main()

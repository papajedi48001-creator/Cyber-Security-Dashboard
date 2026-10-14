"""End-to-end check of the rendered relay with real syslog-ng and synthetic TLS Syslog.

Skipped when syslog-ng or openssl is not installed. Covers: an allowlisted,
trusted sender reaches the Wazuh side; an untrusted certificate is refused;
an allowlisted-certificate sender from a non-allowlisted address is recorded
as rejected; a Wazuh outage buffers events and the health check reports it.
"""
import pathlib
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest

RELAY_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RELAY_DIR))

import relay_health  # noqa: E402
import render_config  # noqa: E402

ALLOWED_IP = "127.0.0.2"
DENIED_IP = "127.0.0.3"
LISTEN_IP = "127.0.0.1"
RELAY_PORT = 6514


def free_port():
    with socket.socket() as sock:
        sock.bind((LISTEN_IP, 0))
        return sock.getsockname()[1]


def openssl(*args, cwd):
    subprocess.run(["openssl", *args], cwd=cwd, check=True, capture_output=True)


def make_pki(directory):
    d = str(directory)
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Test CA",
            "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
            "-keyout", "ca.key", "-out", "ca.crt", cwd=d)
    for name, cn in (("relay", "relay"), ("sophos", "sophos")):
        openssl("req", "-newkey", "rsa:2048", "-nodes", "-subj", f"/CN={cn}",
                "-keyout", f"{name}.key", "-out", f"{name}.csr", cwd=d)
        openssl("x509", "-req", "-in", f"{name}.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
                "-CAcreateserial", "-days", "1", "-out", f"{name}.crt", cwd=d)
    openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=rogue",
            "-keyout", "rogue.key", "-out", "rogue.crt", cwd=d)
    ca_dir = directory / "ca.d"
    ca_dir.mkdir()
    shutil.copy(directory / "ca.crt", ca_dir / "ca.crt")
    openssl("rehash", str(ca_dir), cwd=d)


class FakeWazuh:
    """Line-oriented TCP sink standing in for wazuh-remoted."""

    def __init__(self, port):
        self.port = port
        self.lines = []
        self.server = None
        self.connections = []

    def start(self):
        sink = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                sink.connections.append(self.request)
                for raw in self.rfile:
                    sink.lines.append(raw.decode(errors="replace"))

        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self.server = socketserver.ThreadingTCPServer((LISTEN_IP, self.port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        for conn in self.connections:
            try:
                conn.shutdown(socket.SHUT_RDWR)
                conn.close()
            except OSError:
                pass
        self.connections.clear()

    def received(self, marker):
        return any(marker in line for line in self.lines)


def send_tls(pki, source_ip, marker, cert="sophos"):
    context = ssl.create_default_context(cafile=str(pki / "ca.crt"))
    context.check_hostname = False
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    context.load_cert_chain(str(pki / f"{cert}.crt"), str(pki / f"{cert}.key"))
    raw = socket.create_connection((LISTEN_IP, RELAY_PORT), timeout=5, source_address=(source_ip, 0))
    with context.wrap_socket(raw) as tls:
        message = f"<134>1 2026-10-14T10:00:00Z sophos fw - - - {marker}\n"
        tls.sendall(message.encode())
        tls.settimeout(0.3)
        try:
            tls.recv(1)  # surfaces a TLS alert if the relay rejected our certificate
        except (socket.timeout, TimeoutError):
            pass


def wait_for(predicate, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.2)
    return False


@unittest.skipUnless(shutil.which("syslog-ng") and shutil.which("openssl"), "syslog-ng/openssl not installed")
class SyntheticTlsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = pathlib.Path(tempfile.mkdtemp())
        cls.pki = cls.tmp / "tls"
        cls.pki.mkdir()
        make_pki(cls.pki)
        cls.state = cls.tmp / "state"
        cls.state.mkdir()
        cls.wazuh = FakeWazuh(free_port())
        cls.wazuh.start()
        config = render_config.render(
            (RELAY_DIR / "syslog-ng.conf.template").read_text(),
            ALLOWED_IP,
            listen_ip=LISTEN_IP,
            wazuh_host=LISTEN_IP,
            wazuh_port=str(cls.wazuh.port),
            buffer_size_mb="16",
            tls_dir=str(cls.pki),
            state_dir=str(cls.state),
        )
        cls.conf = cls.tmp / "relay.conf"
        cls.conf.write_text(config)
        cls.control = cls.tmp / "ctl"
        cls.proc = subprocess.Popen(
            ["syslog-ng", "-F", "-f", str(cls.conf), "--pidfile", str(cls.tmp / "pid"),
             "--persist-file", str(cls.tmp / "persist"), "--control", str(cls.control)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        if not wait_for(lambda: cls._port_open(RELAY_PORT)):
            cls.proc.kill()
            raise RuntimeError(cls.proc.stdout.read().decode())

    @staticmethod
    def _port_open(port):
        try:
            socket.create_connection((LISTEN_IP, port), timeout=0.5).close()
            return True
        except OSError:
            return False

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        try:
            cls.wazuh.stop()
        except Exception:
            pass
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def stats(self):
        out = subprocess.run(["syslog-ng-ctl", "stats", "--control", str(self.control)],
                             capture_output=True, text=True, check=True)
        return out.stdout

    def test_1_allowed_trusted_sender_reaches_wazuh(self):
        send_tls(self.pki, ALLOWED_IP, "allowed-event-1")
        self.assertTrue(wait_for(lambda: self.wazuh.received("allowed-event-1")))

    def test_2_untrusted_certificate_is_refused(self):
        try:
            send_tls(self.pki, ALLOWED_IP, "rogue-event", cert="rogue")
        except (ssl.SSLError, ConnectionError, OSError):
            pass
        time.sleep(1)
        self.assertFalse(self.wazuh.received("rogue-event"))

    def test_3_non_allowlisted_address_is_rejected_with_evidence(self):
        send_tls(self.pki, DENIED_IP, "denied-event")
        rejected = self.state / "rejected-senders.log"
        self.assertTrue(wait_for(lambda: rejected.exists() and DENIED_IP in rejected.read_text()))
        self.assertFalse(self.wazuh.received("denied-event"))
        self.assertNotIn("denied-event", rejected.read_text())

    def test_4_wazuh_outage_buffers_and_recovers(self):
        self.wazuh.stop()
        for i in range(20):
            send_tls(self.pki, ALLOWED_IP, f"outage-event-{i}")
        self.assertTrue(wait_for(
            lambda: relay_health.evaluate(self.stats(), queued_warn=5)["status"] == "degraded", timeout=15),
            self.stats())
        self.wazuh.start()
        self.assertTrue(wait_for(lambda: self.wazuh.received("outage-event-19"), timeout=60))
        self.assertTrue(wait_for(
            lambda: relay_health.evaluate(self.stats(), queued_warn=5)["status"] == "healthy", timeout=15))


if __name__ == "__main__":
    unittest.main()

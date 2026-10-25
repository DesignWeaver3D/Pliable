"""Smoke test for the packaged app (or a source checkout): start the launcher headless, then drive the core
over the websocket like the browser does. Exits non-zero on any failure.

Usage: python scripts/smoke.py PATH_TO_LAUNCHER [more launcher args]   (use the packaged executable)
       uv run python scripts/smoke.py source                             (runs `python -m pliable.launcher`)
"""
import base64, json, os, socket, subprocess, sys, time, urllib.request

from websockets.sync.client import connect

STARTUP_TIMEOUT = 120  # a frozen app can be slow on first launch (antivirus scan)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, url):
        self.ws = connect(url, max_size=256 * 1024 * 1024).__enter__()
        self.n = 0

    def request(self, type, **fields):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "type": type, **fields}))
        head = json.loads(self.ws.recv(timeout=120))
        if not head.get("ok"):
            raise RuntimeError(f"{type}: {head.get('error')}")
        if head.get("binary"):
            frame = self.ws.recv(timeout=120)
            hlen = int.from_bytes(frame[:4], "little")
            return json.loads(frame[4 : 4 + hlen])
        return head


def check(cond, message):
    if not cond:
        raise AssertionError(message)
    print("ok:", message, flush=True)


def main():
    target = sys.argv[1]
    extra = sys.argv[2:]
    port = free_port()
    command = [sys.executable, "-m", "pliable.launcher"] if target == "source" else [target]
    process = subprocess.Popen([*command, "--no-browser", "--port", str(port), *extra], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.time() + STARTUP_TIMEOUT
        page = None
        while time.time() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"launcher exited early with code {process.returncode}: {process.stdout.read()[-2000:]}")
            try:
                page = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2).read().decode()
                break
            except OSError:
                time.sleep(0.5)
        check(page is not None, "app started and serves a page")
        check("<script" in page, "served page references the frontend script")
        asset = page.split('src="')[1].split('"')[0]
        check(len(urllib.request.urlopen(f"http://127.0.0.1:{port}{asset}").read()) > 100_000, "frontend script is served")
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/../../etc/passwd")
            check(False, "path traversal is refused")
        except OSError:
            check(True, "path traversal is refused")

        c = Client(f"ws://127.0.0.1:{port}")
        check(c.request("hello").get("version"), "hello returns a version")
        check(len(c.request("list_tools")["tools"]) > 10, "tools are listed")
        mesh = c.request("open_demo", name="bracket")
        faces = len(mesh["faces"])
        check(faces > 5, f"bracket opens ({faces} faces)")
        top = c.request("tool_preview", tool="push_pull", selection={"faces": [0], "edges": [], "vertices": []}, params={"distance": 1.0})
        check(top["kind"] == "mesh", "push/pull preview returns a mesh")
        done = c.request("tool_commit", tool="push_pull", selection={"faces": [0], "edges": [], "vertices": []}, params={"distance": 1.0})
        check(done["canUndo"], "push/pull commit succeeds and can be undone")
        undone = c.request("undo")
        check(len(undone["faces"]) == faces and not undone["canUndo"], "undo restores the bracket")
        exported = c.request("export_step")
        data = base64.b64decode(exported["data"])
        check(data.startswith(b"ISO-10303"), f"STEP export ({len(data)} bytes)")
        again = c.request("import_step", name="roundtrip", data=exported["data"])
        check(len(again["faces"]) == faces, "re-imported STEP has the same face count")
        c.ws.close()
        print("SMOKE TEST PASSED", flush=True)
    finally:
        process.terminate()
        try:
            process.wait(10)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"SMOKE TEST FAILED: {type(e).__name__}: {e}", flush=True)
        sys.exit(1)

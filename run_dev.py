import os
import signal
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from c_engine.build import ensure_c_engine_ready  # noqa: E402


def main():
    ensure_c_engine_ready()

    py_proc = subprocess.Popen([sys.executable, os.path.join(BACKEND_DIR, "server.py"), "--port", "3001"])
    vite_proc = subprocess.Popen(["npx", "vite", "--port=3000", "--host=0.0.0.0"])

    def shutdown(*_args):
        for p in (vite_proc, py_proc):
            if p.poll() is None:
                p.terminate()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        code = vite_proc.wait()
    finally:
        if py_proc.poll() is None:
            py_proc.terminate()
    sys.exit(code)


if __name__ == "__main__":
    main()

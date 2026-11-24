import signal
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
C_SRC = os.path.join(ROOT, "backend", "c_engine", "sla_rbac.c")
C_BIN = os.path.join(ROOT, "backend", "c_engine", "sla_rbac")


def main():
    # Ensure C SLA/RBAC binary is compiled
    if not os.path.exists(C_BIN):
        subprocess.run(["gcc", "-O2", C_SRC, "-o", C_BIN], check=True)

    py_proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "backend", "server.py"), "--port", "3001"])
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

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

C_ENGINE_DIR = Path(__file__).resolve().parent
C_SOURCE = C_ENGINE_DIR / "sla_rbac.c"


class CEngineError(RuntimeError):
    """Raised when the C SLA/RBAC engine cannot be built or executed safely."""


@dataclass(frozen=True)
class CEngineStatus:
    binary_path: Path
    compiled_now: bool
    executable: bool
    up_to_date: bool
    compiler: str


def default_binary_path(engine_dir: Path = C_ENGINE_DIR) -> Path:
    name = "sla_rbac.exe" if os.name == "nt" else "sla_rbac"
    return engine_dir / name


def find_c_compiler() -> str | None:
    for candidate in (os.environ.get("CC", "").strip(), "gcc", "clang", "cc"):
        if candidate and shutil.which(candidate):
            return candidate
    return None


def needs_rebuild(source_path: Path = C_SOURCE, binary_path: Path | None = None) -> tuple[bool, str]:
    bin_path = binary_path or default_binary_path(source_path.parent)
    if not source_path.exists():
        raise CEngineError(f"Authoritative C source missing: {source_path}")
    if not bin_path.exists():
        return True, "binary_missing"
    if not bin_path.is_file():
        return True, "binary_not_regular_file"
    if os.name != "nt" and not os.access(bin_path, os.X_OK):
        return True, "binary_not_executable"
    try:
        src_mtime = source_path.stat().st_mtime_ns
        bin_mtime = bin_path.stat().st_mtime_ns
    except OSError as exc:
        return True, f"stat_failed:{exc}"
    if src_mtime > bin_mtime:
        return True, "binary_outdated"
    return False, "up_to_date"


def build_c_engine(
    source_path: Path = C_SOURCE,
    binary_path: Path | None = None,
    force: bool = False,
) -> CEngineStatus:
    bin_path = binary_path or default_binary_path(source_path.parent)
    if not source_path.exists():
        raise CEngineError(f"C engine source not found at {source_path}")

    rebuild_required, reason = (True, "forced") if force else needs_rebuild(source_path, bin_path)
    compiler = find_c_compiler() or "none"
    compiled_now = False

    if rebuild_required:
        # If only executable bit is missing and binary is newer than source, still re-compile or chmod cleanly
        if reason == "binary_not_executable" and bin_path.exists():
            # Prefer clean recompile if compiler is available; if compiler absent, fail explicitly or chmod?
            # Rebuilding ensures integrity if extracted without exec bits.
            pass
        if compiler == "none":
            raise CEngineError(
                f"C compiler (gcc/clang/cc) is required to build {source_path.name} (reason: {reason})."
            )
        bin_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = bin_path.with_name(f".{bin_path.name}.tmp.{os.getpid()}")
        cmd = [compiler, "-O2", "-Wall", "-Wextra", "-Werror", str(source_path), "-o", str(tmp_path)]
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
            diag = (proc.stderr or proc.stdout or "unknown compiler error").strip()
            raise CEngineError(f"C engine compilation failed ({compiler} exit {proc.returncode}): {diag}")
        if os.name != "nt":
            mode = tmp_path.stat().st_mode
            tmp_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH)
        os.replace(tmp_path, bin_path)
        compiled_now = True

    if os.name != "nt" and not os.access(bin_path, os.X_OK):
        raise CEngineError(f"Compiled C engine is not executable: {bin_path}")

    return CEngineStatus(
        binary_path=bin_path,
        compiled_now=compiled_now,
        executable=True,
        up_to_date=True,
        compiler=compiler,
    )


def verify_c_engine(binary_path: Path | None = None) -> None:
    bin_path = binary_path or default_binary_path()
    if not bin_path.exists():
        raise CEngineError(f"C engine binary missing: {bin_path}")
    if os.name != "nt" and not os.access(bin_path, os.X_OK):
        raise CEngineError(f"C engine binary lacks executable permissions: {bin_path}")
    try:
        proc = subprocess.run(
            [str(bin_path), "sla", "3", "7", "0"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except OSError as exc:
        raise CEngineError(f"Failed executing C engine binary {bin_path}: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise CEngineError(f"C engine timed out during startup self-test: {exc}") from exc

    if proc.returncode != 0 or '"remainingDays":4' not in proc.stdout:
        raise CEngineError(
            f"C engine self-test failed (exit {proc.returncode}): stdout={proc.stdout!r} stderr={proc.stderr!r}"
        )


def ensure_c_engine_ready(
    source_path: Path = C_SOURCE,
    binary_path: Path | None = None,
    force: bool = False,
) -> CEngineStatus:
    status = build_c_engine(source_path=source_path, binary_path=binary_path, force=force)
    verify_c_engine(status.binary_path)
    return status


if __name__ == "__main__":
    force_flag = "--force" in sys.argv
    st = ensure_c_engine_ready(force=force_flag)
    print(
        f"C engine verified: {st.binary_path} (compiled_now={st.compiled_now}, compiler={st.compiler})"
    )

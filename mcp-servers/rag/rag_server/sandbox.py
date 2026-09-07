"""Tiered execution boundary for query_spreadsheet: Docker if available and running,
else a plain subprocess — but ALWAYS a separate OS process, never in-process `exec()`.

Why a process either way, not just restricted globals: CPython cannot safely force-kill
a running thread, so a hang (an infinite loop, a memory bomb — neither needs any
dangerous import) can only be reliably stopped by a parent that SIGKILLs a child
process. That guarantee is independent of how restricted the executed code's namespace
is, and it's the actual reason this module exists.

Docker tier gives what a bare subprocess cannot: real network denial (--network none)
and kernel-enforced resource caps (--memory/--cpus), not best-effort ones. It needs the
`rag-sandbox` image built once (one-time network use, at first call) via the Dockerfile
shipped alongside this package; every call after that runs with no network.
"""

from __future__ import annotations

import os
import pickle
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

MAX_RESULT_CHARS = 20_000
DEFAULT_TIMEOUT = int(os.environ.get("RAG_SANDBOX_TIMEOUT", "20"))
_WORKER = str(Path(__file__).parent / "sandbox_worker.py")
_DOCKERFILE_DIR = str(Path(__file__).parent.parent / "docker")
_IMAGE = "rag-sandbox:latest"

_docker_checked_at: float = 0.0
_docker_ok: bool = False
_DOCKER_RECHECK_SECS = 60


def docker_available() -> bool:
    """Cached, periodically re-checked — a daemon that starts/stops between calls
    shouldn't need a server restart to be picked up."""
    global _docker_checked_at, _docker_ok
    now = time.time()
    if now - _docker_checked_at < _DOCKER_RECHECK_SECS:
        return _docker_ok
    _docker_checked_at = now
    try:
        subprocess.run(
            ["docker", "info"], capture_output=True, timeout=3, check=True
        )
        _docker_ok = True
    except Exception:
        _docker_ok = False
    return _docker_ok


def _ensure_image() -> bool:
    """True if the sandbox image exists or was built successfully."""
    check = subprocess.run(
        ["docker", "image", "inspect", _IMAGE], capture_output=True, timeout=5
    )
    if check.returncode == 0:
        return True
    build = subprocess.run(
        ["docker", "build", "-t", _IMAGE, _DOCKERFILE_DIR],
        capture_output=True,
        timeout=300,  # one-time cost, first call only
    )
    return build.returncode == 0


def _truncate(text: Optional[str]) -> Optional[str]:
    if text is None:
        return None
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "\n[truncated]"


def run(sheets: dict[str, Any], code: str, *, timeout: int = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """Execute `code` against `sheets` (dict[str, pd.DataFrame]). Always returns a
    dict with at least {"ok": bool}; never raises for a sandboxed failure — only for a
    setup problem (e.g. neither tier is usable)."""
    payload = pickle.dumps({"sheets": sheets, "code": code})

    if docker_available() and _ensure_image():
        result = _run_docker(payload, timeout=timeout)
    else:
        result = _run_subprocess(payload, timeout=timeout)

    if "error" in result and result["error"]:
        result["error"] = _truncate(result["error"])
    if "printed" in result and result["printed"]:
        result["printed"] = _truncate(result["printed"])
    if "result" in result and result["result"]:
        result["result"] = _truncate(result["result"])
    return result


def _run_subprocess(payload: bytes, *, timeout: int) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            [sys.executable, _WORKER],
            input=payload,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"execution timed out after {timeout}s and was killed"}
    if proc.returncode != 0:
        return {
            "ok": False,
            "error": f"sandbox process exited {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', 'replace')[-2000:]}",
        }
    import json

    try:
        return json.loads(proc.stdout.decode("utf-8", "replace"))
    except Exception as exc:
        return {"ok": False, "error": f"could not parse sandbox output: {exc}"}


def _run_docker(payload: bytes, *, timeout: int) -> dict[str, Any]:
    import json
    import tempfile

    work = Path(tempfile.mkdtemp(prefix="rag-sandbox-"))
    try:
        (work / "payload.pkl").write_bytes(payload)
        shutil.copy(_WORKER, work / "sandbox_worker.py")
        name = f"rag-sandbox-{uuid.uuid4().hex[:12]}"
        run_cmd = [
            "docker", "run", "-d", "--name", name,
            "--network", "none", "--memory", "512m", "--cpus", "1",
            "-v", f"{work}:/data",
            _IMAGE,
            "sh", "-c",
            "python /data/sandbox_worker.py < /data/payload.pkl > /data/result.json "
            "2> /data/stderr.log",
        ]
        started = subprocess.run(run_cmd, capture_output=True, timeout=10)
        if started.returncode != 0:
            return {
                "ok": False,
                "error": f"docker run failed: {started.stderr.decode('utf-8', 'replace')}",
            }
        try:
            subprocess.run(
                ["docker", "wait", name], capture_output=True, timeout=timeout
            )
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "kill", name], capture_output=True, timeout=10)
            return {"ok": False, "error": f"execution timed out after {timeout}s and was killed"}
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10)

        result_path = work / "result.json"
        if not result_path.is_file():
            stderr = (work / "stderr.log")
            detail = stderr.read_text(errors="replace")[-2000:] if stderr.is_file() else ""
            return {"ok": False, "error": f"sandbox produced no output. {detail}"}
        try:
            return json.loads(result_path.read_text())
        except Exception as exc:
            return {"ok": False, "error": f"could not parse sandbox output: {exc}"}
    finally:
        shutil.rmtree(work, ignore_errors=True)

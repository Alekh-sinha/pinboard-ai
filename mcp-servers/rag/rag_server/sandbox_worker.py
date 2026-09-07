"""Runs INSIDE the sandboxed subprocess (or the Docker container) — never imported by
the server directly. Receives a pickled dict of DataFrames + a code string on stdin,
executes the code under a restricted namespace, and writes a JSON result to stdout.

This restricted-globals layer narrows casual/unsophisticated misuse (per the
object-graph-escape discussion: it is NOT airtight on its own — `().__class__.__bases__
[0].__subclasses__()` and similar tricks can still reach dangerous objects from pure
Python, no import required). It is the SECOND layer, not the boundary that actually
matters: the boundary that matters is that this runs as a separate OS process the
parent can SIGKILL on timeout (sandbox.py), because CPython cannot safely force-kill a
running thread — a hang inside this script gets stopped from outside, not by anything
in here cooperating.
"""

from __future__ import annotations

import io
import json
import pickle
import sys
import traceback

_ALLOWED_BUILTINS = (
    "abs", "all", "any", "bool", "dict", "enumerate", "float", "int", "len",
    "list", "max", "min", "print", "range", "round", "set", "sorted", "str",
    "sum", "tuple", "zip",
)


def main() -> None:
    raw = sys.stdin.buffer.read()
    payload = pickle.loads(raw)
    sheets = payload["sheets"]  # dict[str, pd.DataFrame]
    code = payload["code"]

    import pandas as pd

    restricted_builtins = {name: __builtins__[name] if isinstance(__builtins__, dict) else getattr(__builtins__, name)
                            for name in _ALLOWED_BUILTINS}
    namespace = {"__builtins__": restricted_builtins, "pd": pd, "sheets": sheets}

    out_buffer = io.StringIO()
    real_stdout = sys.stdout
    sys.stdout = out_buffer
    try:
        exec(compile(code, "<query_spreadsheet>", "exec"), namespace)
        result = namespace.get("result")
        ok = True
        error = None
    except Exception:
        result = None
        ok = False
        error = traceback.format_exc(limit=4)
    finally:
        sys.stdout = real_stdout

    printed = out_buffer.getvalue()
    try:
        result_repr = repr(result) if result is not None else None
    except Exception:
        result_repr = "<unrepresentable result>"

    json.dump({"ok": ok, "error": error, "printed": printed, "result": result_repr}, sys.stdout)


if __name__ == "__main__":
    main()

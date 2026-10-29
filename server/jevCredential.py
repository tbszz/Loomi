#!/usr/bin/env python3
"""Read the current Windows user's TypeSafe JEV API key.

The key is written to stdout for the parent Node process to consume in memory.
No command-line argument or file is used for the secret.
"""

from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes


TARGET = "JEV_TypeSafe_API_Key"
HANDSHAKE_ENV = "RESUME_PROTOCOL_JEV_CREDENTIAL_HELPER"
_CRED_TYPE_GENERIC = 1
_ERROR_NOT_FOUND = 1168


class _FileTime(ctypes.Structure):
    _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]


class _Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", _FileTime),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


_CredentialPointer = ctypes.POINTER(_Credential)


def _read_key() -> str | None:
    if sys.platform != "win32":
        return None

    advapi = ctypes.WinDLL("Advapi32", use_last_error=True)
    advapi.CredReadW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(_CredentialPointer),
    ]
    advapi.CredReadW.restype = wintypes.BOOL
    advapi.CredFree.argtypes = [ctypes.c_void_p]
    advapi.CredFree.restype = None

    credential = _CredentialPointer()
    if not advapi.CredReadW(TARGET, _CRED_TYPE_GENERIC, 0, ctypes.byref(credential)):
        code = ctypes.get_last_error()
        if code == _ERROR_NOT_FOUND:
            return None
        raise OSError(code, "Windows Credential Manager could not read the JEV key")

    try:
        blob = ctypes.string_at(
            credential.contents.CredentialBlob,
            credential.contents.CredentialBlobSize,
        )
        return blob.decode("utf-8")
    finally:
        advapi.CredFree(credential)


def main() -> int:
    if os.environ.get(HANDSHAKE_ENV) != "1":
        return 2
    try:
        key = (_read_key() or "").strip()
    except (OSError, UnicodeError):
        return 3
    if key:
        sys.stdout.write(key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

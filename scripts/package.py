#!/usr/bin/env python3
"""
Figma MCP Bridge - Packaging Utility
Builds distributable release archives for Chrome extension (zip) and MCP server (tar.gz).
"""

import os
import sys
import json
import zipfile
import tarfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(ROOT_DIR, "dist")
os.makedirs(DIST_DIR, exist_ok=True)

# Read version from package.json
pkg_path = os.path.join(ROOT_DIR, "package.json")
with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)
version = pkg.get("version", "1.1.0")

extension_zip_path = os.path.join(DIST_DIR, f"figma-mcp-bridge-{version}.zip")
server_tar_path = os.path.join(DIST_DIR, f"figma-mcp-server-{version}.tar.gz")

print(f"[*] Packaging Figma MCP Bridge v{version}...")

# 1. Package Chrome Extension
extension_files = [
    "manifest.json",
    "background.js",
    "content.js",
    "inject.js",
    "popup.html",
    "popup.js",
    "popup.css",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "icons/icon.svg",
    "LICENSE",
]

print(f"[*] Building extension zip: {extension_zip_path}")
with zipfile.ZipFile(extension_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for rel_path in extension_files:
        full_path = os.path.join(ROOT_DIR, rel_path)
        if os.path.exists(full_path):
            zf.write(full_path, arcname=rel_path)
            print(f"  + {rel_path}")
        else:
            print(f"  ! Warning: {rel_path} not found")

# 2. Package Local MCP Server
server_files = [
    ("server/index.js", "index.js"),
    ("server/session_manager.js", "session_manager.js"),
    ("server/session_sync.py", "session_sync.py"),
    ("server/package.json", "package.json"),
    ("server/package-lock.json", "package-lock.json"),
    ("LICENSE", "LICENSE"),
]

print(f"[*] Building server tarball: {server_tar_path}")
with tarfile.open(server_tar_path, "w:gz") as tf:
    for src_rel, arcname in server_files:
        full_path = os.path.join(ROOT_DIR, src_rel)
        if os.path.exists(full_path):
            tf.add(full_path, arcname=arcname)
            print(f"  + {arcname} (from {src_rel})")
        else:
            print(f"  ! Warning: {src_rel} not found")

print(f"[OK] Release artifacts successfully generated in {DIST_DIR}:")
print(f"    - {os.path.basename(extension_zip_path)} ({os.path.getsize(extension_zip_path):,} bytes)")
print(f"    - {os.path.basename(server_tar_path)} ({os.path.getsize(server_tar_path):,} bytes)")

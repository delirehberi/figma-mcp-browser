#!/usr/bin/env python3
"""
Figma MCP Bridge - Packaging Utility
Builds distributable release archives:
  1. Chrome Extension (.zip)
  2. Standalone MCP Server (.tar.gz)
  3. Universal Suite (.zip) — Extension, Server, Harnesses, Setup scripts, and Skills
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
suite_zip_path = os.path.join(DIST_DIR, f"figma-mcp-universal-suite-{version}.zip")

print(f"[*] Packaging Figma MCP Bridge Suite v{version}...")

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

print(f"\n[*] 1. Building Chrome extension zip: {extension_zip_path}")
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

print(f"\n[*] 2. Building MCP server tarball: {server_tar_path}")
with tarfile.open(server_tar_path, "w:gz") as tf:
    for src_rel, arcname in server_files:
        full_path = os.path.join(ROOT_DIR, src_rel)
        if os.path.exists(full_path):
            tf.add(full_path, arcname=arcname)
            print(f"  + {arcname} (from {src_rel})")
        else:
            print(f"  ! Warning: {src_rel} not found")

# 3. Package Universal Suite (.zip)
print(f"\n[*] 3. Building Universal Suite zip: {suite_zip_path}")
with zipfile.ZipFile(suite_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
    # Extension in extension/ subfolder
    for rel_path in extension_files:
        full_path = os.path.join(ROOT_DIR, rel_path)
        if os.path.exists(full_path):
            zf.write(full_path, arcname=f"extension/{rel_path}")

    # Server in server/ subfolder
    for src_rel, arcname in server_files:
        full_path = os.path.join(ROOT_DIR, src_rel)
        if os.path.exists(full_path):
            zf.write(full_path, arcname=f"server/{arcname}")

    # Root launchers and scripts
    root_items = [
        ("setup.bat", "setup.bat"),
        ("setup.sh", "setup.sh"),
        ("package.json", "package.json"),
        ("README.md", "README.md"),
        ("LICENSE", "LICENSE"),
        ("bin/figma-mcp-browser.js", "bin/figma-mcp-browser.js"),
        ("scripts/setup-harness.js", "scripts/setup-harness.js"),
    ]
    for src_rel, arcname in root_items:
        full_path = os.path.join(ROOT_DIR, src_rel)
        if os.path.exists(full_path):
            zf.write(full_path, arcname=arcname)
            print(f"  + {arcname}")

    # Harness presets
    harnesses_dir = os.path.join(ROOT_DIR, "harnesses")
    if os.path.exists(harnesses_dir):
        for h in os.listdir(harnesses_dir):
            full_path = os.path.join(harnesses_dir, h)
            if os.path.isfile(full_path):
                zf.write(full_path, arcname=f"harnesses/{h}")
                print(f"  + harnesses/{h}")

    # Skills
    skills_dir = os.path.join(ROOT_DIR, ".agents", "skills")
    if os.path.exists(skills_dir):
        for root, _, files in os.walk(skills_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel = os.path.relpath(full_path, skills_dir)
                zf.write(full_path, arcname=f"skills/{rel}")
                print(f"  + skills/{rel}")

print(f"\n[OK] All 3 release artifacts successfully generated in {DIST_DIR}:")
print(f"    - {os.path.basename(extension_zip_path)} ({os.path.getsize(extension_zip_path):,} bytes)")
print(f"    - {os.path.basename(server_tar_path)} ({os.path.getsize(server_tar_path):,} bytes)")
print(f"    - {os.path.basename(suite_zip_path)} ({os.path.getsize(suite_zip_path):,} bytes)")

"""
Figma Session Sync Utility
Extracts active session cookies from the last completed Figma login
(Figma Desktop or Chrome) and syncs them into the MCP browser profile.
"""

import os
import sys
import json
import sqlite3
import base64
import subprocess
import time
import ctypes
import hashlib
import argparse
from ctypes import wintypes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from datetime import datetime, timezone

is_windows = sys.platform == 'win32'
if is_windows:
    kernel32 = ctypes.windll.kernel32
    kernel32.DuplicateHandle.argtypes = [
        wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD
    ]
    GetFinalPathNameByHandleW = kernel32.GetFinalPathNameByHandleW
    GetFinalPathNameByHandleW.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
else:
    kernel32 = None
    GetFinalPathNameByHandleW = None

def get_dpapi_key(local_state_path):
    if not os.path.exists(local_state_path):
        return None
    try:
        with open(local_state_path, 'r', encoding='utf-8') as f:
            local_state = json.load(f)
        encrypted_key_b64 = local_state['os_crypt']['encrypted_key']
        encrypted_key = base64.b64decode(encrypted_key_b64)[5:] # strip DPAPI prefix
        ps_cmd = (
            "Add-Type -AssemblyName System.Security; "
            f"$enc = [System.Convert]::FromBase64String('{base64.b64encode(encrypted_key).decode()}'); "
            "[System.Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))"
        )
        result = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, check=True)
        return base64.b64decode(result.stdout.strip())
    except Exception as e:
        return None

def read_db_from_handle(pid, handle_val, dst_path):
    if not is_windows or not kernel32:
        return False
    h_proc = kernel32.OpenProcess(0x0040, False, pid)
    if not h_proc:
        raise RuntimeError(f"Could not open process PID {pid}")
    h_curr = kernel32.GetCurrentProcess()
    target_h = wintypes.HANDLE()
    r = kernel32.DuplicateHandle(h_proc, ctypes.c_void_p(handle_val), h_curr, ctypes.byref(target_h), 0, False, 2)
    kernel32.CloseHandle(h_proc)
    if not r:
        raise RuntimeError(f"DuplicateHandle failed for PID {pid}, handle {handle_val}")

    orig_pos = kernel32.SetFilePointer(target_h, 0, None, 1)
    kernel32.SetFilePointer(target_h, 0, None, 0)

    chunk_sz = 64 * 1024
    buf = ctypes.create_string_buffer(chunk_sz)
    read_bytes = wintypes.DWORD()

    with open(dst_path, 'wb') as f:
        while True:
            succ = kernel32.ReadFile(target_h, buf, chunk_sz, ctypes.byref(read_bytes), None)
            if not succ or read_bytes.value == 0:
                break
            f.write(buf.raw[:read_bytes.value])

    kernel32.SetFilePointer(target_h, orig_pos, None, 0)
    kernel32.CloseHandle(target_h)

def find_open_cookies_handle(process_name_pattern="figma"):
    ps_cmd = f'Get-Process | Where-Object {{ $_.ProcessName -match "{process_name_pattern}" }} | Select-Object -ExpandProperty Id'
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
    pids = [int(p.strip()) for p in res.stdout.strip().split() if p.strip().isdigit()]

    h_curr = kernel32.GetCurrentProcess()
    path_buf = (wintypes.WCHAR * 1024)()

    for pid in pids:
        h_proc = kernel32.OpenProcess(0x0040, False, pid)
        if not h_proc:
            continue
        try:
            for h_val in range(4, 16000, 4):
                target_h = wintypes.HANDLE()
                r = kernel32.DuplicateHandle(h_proc, ctypes.c_void_p(h_val), h_curr, ctypes.byref(target_h), 0, False, 2)
                if r:
                    ft = kernel32.GetFileType(target_h)
                    if ft == 1:
                        ret = GetFinalPathNameByHandleW(target_h, path_buf, 1024, 0)
                        if ret > 0 and "Cookies" in path_buf.value and not "journal" in path_buf.value:
                            kernel32.CloseHandle(target_h)
                            return pid, h_val, path_buf.value
                    kernel32.CloseHandle(target_h)
        finally:
            kernel32.CloseHandle(h_proc)
    return None, None, None

def chrome_time_to_dt(microseconds):
    if not microseconds:
        return None
    epoch_diff = 11644473600
    seconds = (microseconds / 1000000.0) - epoch_diff
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    except:
        return None

def extract_cookies_from_source(name, local_state_path, cookies_path, proc_name=None):
    if not os.path.exists(local_state_path):
        return None

    key = get_dpapi_key(local_state_path)
    if not key:
        return None

    temp_db = os.path.join(os.environ.get('TEMP', '.'), f'figma_extract_{os.getpid()}_{hash(name)}.db')
    copied = False

    # Try direct copy first
    try:
        import shutil
        shutil.copy2(cookies_path, temp_db)
        copied = True
    except Exception:
        pass

    # If locked, try handle duplicate from running process
    if not copied and proc_name:
        pid, h_val, full_path = find_open_cookies_handle(proc_name)
        if pid and h_val:
            try:
                read_db_from_handle(pid, h_val, temp_db)
                copied = True
            except Exception:
                pass

    if not copied:
        return None

    try:
        conn = sqlite3.connect(temp_db)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT creation_utc, host_key, top_frame_site_key, name, value, encrypted_value,
                   path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires,
                   is_persistent, priority, samesite, source_scheme, source_port,
                   last_update_utc, source_type, has_cross_site_ancestor
            FROM cookies WHERE host_key LIKE '%figma.com%'
        """)
        rows = cursor.fetchall()
        conn.close()
    except Exception as e:
        rows = []
    finally:
        if os.path.exists(temp_db):
            try: os.remove(temp_db)
            except: pass

    if not rows:
        return None

    aesgcm = AESGCM(key)
    cookies = []
    has_session = False

    for r in rows:
        (c_utc, host, top_frame, c_name, val, enc, path, exp_utc, sec, http_only, la_utc,
         has_exp, is_pers, priority, samesite, src_scheme, src_port, lu_utc, src_type, cross_site) = r
        raw_val = val
        if not raw_val and enc:
            if enc.startswith(b'v10') or enc.startswith(b'v11'):
                nonce = enc[3:15]
                ciphertext = enc[15:]
                try:
                    dec = aesgcm.decrypt(nonce, ciphertext, None)
                    raw_val = dec[32:].decode('utf-8')
                except Exception:
                    pass

        if c_name in ('figma.session', '__Host-figma.authn') and raw_val:
            has_session = True

        cookies.append({
            'creation_utc': c_utc,
            'host_key': host,
            'top_frame_site_key': top_frame,
            'name': c_name,
            'raw_value': raw_val,
            'path': path,
            'expires_utc': exp_utc,
            'is_secure': sec,
            'is_httponly': http_only,
            'last_access_utc': la_utc,
            'has_expires': has_exp,
            'is_persistent': is_pers,
            'priority': priority,
            'samesite': samesite,
            'source_scheme': src_scheme,
            'source_port': src_port,
            'last_update_utc': lu_utc,
            'source_type': src_type,
            'has_cross_site_ancestor': cross_site
        })

    return {
        'source_name': name,
        'has_session': has_session,
        'cookies': cookies
    }

def get_last_completed_login_session():
    """
    Scans potential sources of Figma logins:
    1. Figma Desktop Profile
    2. Chrome Default User Data
    Returns the source with the most recent authenticated session.
    """
    if not is_windows:
        fallback_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figma_session.json')
        if os.path.exists(fallback_json):
            with open(fallback_json, 'r', encoding='utf-8') as f:
                return json.load(f)
        return None

    candidates = []

    # 1. Figma Desktop
    figma_profile_base = os.path.expandvars(r'%APPDATA%\Figma\DesktopProfile')
    if os.path.exists(figma_profile_base):
        versions = [d for d in os.listdir(figma_profile_base) if os.path.isdir(os.path.join(figma_profile_base, d))]
        versions.sort(reverse=True)
        for ver in versions:
            local_state = os.path.join(figma_profile_base, ver, 'Local State')
            cookies_db = os.path.join(figma_profile_base, ver, 'Network', 'Cookies')
            res = extract_cookies_from_source(f"Figma Desktop ({ver})", local_state, cookies_db, "figma")
            if res and res['has_session']:
                candidates.append(res)
                break

    # 2. Chrome Default & Profiles
    chrome_ud = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data')
    if os.path.exists(chrome_ud):
        for prof in ['Default', 'Profile 1', 'Profile 2']:
            local_state = os.path.join(chrome_ud, 'Local State')
            cookies_db = os.path.join(chrome_ud, prof, 'Network', 'Cookies')
            res = extract_cookies_from_source(f"Chrome ({prof})", local_state, cookies_db, "chrome")
            if res and res['has_session']:
                candidates.append(res)

    if not candidates:
        # Fallback: check if clean JSON was saved previously
        fallback_json = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figma_session.json')
        if os.path.exists(fallback_json):
            with open(fallback_json, 'r', encoding='utf-8') as f:
                saved = json.load(f)
                return saved

    if not candidates:
        return None

    # Pick candidate with most recent last_access_utc for figma.session or figma.auth_id
    def score_candidate(cand):
        score = 0
        for c in cand['cookies']:
            if c['name'] in ('figma.session', '__Host-figma.authn', 'figma.auth_id'):
                score = max(score, c.get('last_access_utc') or 0, c.get('creation_utc') or 0)
        return score

    candidates.sort(key=score_candidate, reverse=True)
    return candidates[0]

def parse_session_metadata(cookies):
    cookie_map = {c['name']: c['raw_value'] for c in cookies if c.get('raw_value')}
    user_id = None
    email = None
    plan = None
    expires_at = None

    recent_data = cookie_map.get('recent_user_data')
    if recent_data:
        try:
            import urllib.parse
            unq = urllib.parse.unquote(recent_data).strip('"')
            padded = unq + '=' * ((4 - len(unq) % 4) % 4)
            data = json.loads(base64.b64decode(padded).decode('utf-8'))
            user_id = data.get('fileBrowserUserId') or data.get('userId')
        except Exception:
            pass

    user_prefs = cookie_map.get('__Host-figma.user_prefs')
    if user_prefs:
        try:
            import urllib.parse
            parts = user_prefs.split('.')
            if len(parts) >= 3:
                payload_b64 = parts[2]
                padded = payload_b64 + '=' * ((4 - len(payload_b64) % 4) % 4)
                data = json.loads(base64.b64decode(padded).decode('utf-8'))
                if isinstance(data, list) and len(data) > 0:
                    email = data[0].get('e')
                    plan = data[0].get('pt')
        except Exception:
            pass

    # Expiry from figma.session cookie
    for c in cookies:
        if c['name'] == 'figma.session' and c.get('expires_utc'):
            expires_at = chrome_time_to_dt(c['expires_utc'])
            break

    return {
        'authenticated': bool(cookie_map.get('figma.session') or cookie_map.get('__Host-figma.authn')),
        'userId': user_id,
        'email': email,
        'plan': plan,
        'sessionExpires': expires_at,
        'cookieCount': len(cookie_map),
        'availableCookies': list(cookie_map.keys())
    }

def terminate_mcp_chrome():
    ps_cmd = 'Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "chrome.exe" -and $_.CommandLine -like "*chrome-devtools-mcp*" } | Select-Object -ExpandProperty ProcessId'
    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True)
    pids = [int(p.strip()) for p in res.stdout.strip().split() if p.strip().isdigit()]
    if pids:
        for pid in pids:
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
            except:
                pass
        time.sleep(1.5)

def sync_to_mcp_profile(session_data):
    cookies = session_data['cookies']
    mcp_profile_dir = os.path.expandvars(r'%USERPROFILE%\.cache\chrome-devtools-mcp\chrome-profile')
    mcp_local_state = os.path.join(mcp_profile_dir, 'Local State')
    mcp_cookies_db = os.path.join(mcp_profile_dir, 'Default', 'Network', 'Cookies')

    if not os.path.exists(mcp_cookies_db):
        os.makedirs(os.path.dirname(mcp_cookies_db), exist_ok=True)

    terminate_mcp_chrome()

    mcp_key = get_dpapi_key(mcp_local_state)
    if not mcp_key:
        raise RuntimeError(f"Could not retrieve DPAPI master key from {mcp_local_state}")

    mcp_aesgcm = AESGCM(mcp_key)

    conn = sqlite3.connect(mcp_cookies_db)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cookies (
            creation_utc INTEGER NOT NULL,
            host_key TEXT NOT NULL,
            top_frame_site_key TEXT NOT NULL,
            name TEXT NOT NULL,
            value TEXT NOT NULL,
            encrypted_value BLOB NOT NULL,
            path TEXT NOT NULL,
            expires_utc INTEGER NOT NULL,
            is_secure INTEGER NOT NULL,
            is_httponly INTEGER NOT NULL,
            last_access_utc INTEGER NOT NULL,
            has_expires INTEGER NOT NULL,
            is_persistent INTEGER NOT NULL,
            priority INTEGER NOT NULL,
            samesite INTEGER NOT NULL,
            source_scheme INTEGER NOT NULL,
            source_port INTEGER NOT NULL,
            last_update_utc INTEGER NOT NULL,
            source_type INTEGER NOT NULL,
            has_cross_site_ancestor INTEGER NOT NULL,
            PRIMARY KEY (host_key, top_frame_site_key, name, path)
        )
    """)

    cursor.execute("DELETE FROM cookies WHERE host_key LIKE '%figma.com%'")

    inserted = 0
    for c in cookies:
        raw_val = c.get('raw_value')
        if not raw_val:
            continue
        host = c['host_key']
        prefix = hashlib.sha256(host.encode('utf-8')).digest()
        nonce = os.urandom(12)
        payload = prefix + raw_val.encode('utf-8')
        ciphertext = mcp_aesgcm.encrypt(nonce, payload, None)
        enc_blob = b'v10' + nonce + ciphertext

        cursor.execute("""
            INSERT OR REPLACE INTO cookies (
                creation_utc, host_key, top_frame_site_key, name, value, encrypted_value,
                path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires,
                is_persistent, priority, samesite, source_scheme, source_port,
                last_update_utc, source_type, has_cross_site_ancestor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            c['creation_utc'],
            host,
            c.get('top_frame_site_key') or '',
            c['name'],
            '',
            enc_blob,
            c.get('path') or '/',
            c.get('expires_utc') or 0,
            c['is_secure'],
            c['is_httponly'],
            c['last_access_utc'],
            c['has_expires'],
            c['is_persistent'],
            c['priority'],
            c['samesite'],
            c['source_scheme'],
            c['source_port'],
            c['last_update_utc'],
            c['source_type'],
            c['has_cross_site_ancestor']
        ))
        inserted += 1

    conn.commit()
    conn.close()
    return inserted

def main():
    parser = argparse.ArgumentParser(description="Figma Session Sync Utility")
    parser.add_argument("--status", action="store_true", help="Print status of the latest Figma session")
    parser.add_argument("--sync-mcp", action="store_true", help="Sync session cookies into MCP browser profile")
    parser.add_argument("--export", type=str, help="Export clean session cookies to JSON file")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    args = parser.parse_args()

    session_data = get_last_completed_login_session()
    if not session_data:
        res = {"success": False, "error": "No active Figma session found on local machine."}
        if args.json:
            print(json.dumps(res))
        else:
            print("[Figma Session] Error: No active Figma session found.")
        sys.exit(1)

    meta = parse_session_metadata(session_data['cookies'])
    meta['source'] = session_data['source_name']

    if args.export:
        cookie_map = {c['name']: c['raw_value'] for c in session_data['cookies'] if c.get('raw_value')}
        with open(args.export, 'w', encoding='utf-8') as f:
            json.dump(cookie_map, f, indent=2)
        if not args.json:
            print(f"[Figma Session] Exported {len(cookie_map)} cookies to {args.export}")

    if args.sync_mcp:
        synced_count = sync_to_mcp_profile(session_data)
        meta['syncedCookies'] = synced_count
        if not args.json:
            print(f"[Figma Session] Synced {synced_count} cookies from {session_data['source_name']} to MCP browser profile.")

    if args.json:
        print(json.dumps({"success": True, "metadata": meta}))
    elif args.status or not (args.sync_mcp or args.export):
        print(f"--- Figma Session Status ---")
        print(f"Source: {meta['source']}")
        print(f"Authenticated: {meta['authenticated']}")
        print(f"User ID: {meta['userId']}")
        print(f"Email: {meta['email']}")
        print(f"Plan: {meta['plan']}")
        print(f"Session Expiry: {meta['sessionExpires']}")
        print(f"Cookie Count: {meta['cookieCount']}")
        print(f"Cookies: {', '.join(meta['availableCookies'][:8])}...")

if __name__ == '__main__':
    main()

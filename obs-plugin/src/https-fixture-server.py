#!/usr/bin/env python3
"""Loopback-only TLS fixture for the isolated CEF test, never production traffic."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import ssl
import sys
import os
import threading

# CTest may forcibly terminate a failed native test. Its own fixture server
# must exit with that parent too, without affecting any other Python process.
def watch_parent():
    import ctypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    handle = kernel.OpenProcess(0x00100000, False, os.getppid())
    if handle:
        kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
    os._exit(0)

if os.name == 'nt':
    threading.Thread(target=watch_parent, daemon=True).start()

folder = Path(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    ad_requests = 0
    def log_message(self, *_args):
        pass

    def do_GET(self):
        mime = 'application/json'
        if 'googleads.g.doubleclick.net' in self.headers.get('Host', ''):
            type(self).ad_requests += 1
            body = b'ad was delivered'
        elif self.path.startswith('/stats-fixture'):
            body = json.dumps({'adRequests': type(self).ad_requests}).encode()
        elif self.path.startswith('/account-cookie-fixture'):
            mime = 'text/html'
            preserved = 'playback_fixture=connected' in self.headers.get('Cookie', '')
            body = ("<script>document.title='continuity:" + ('passed' if preserved else 'failed') + "'</script>").encode()
        elif self.path.startswith('/account-fixture'):
            body = json.dumps({'playabilityStatus': {'status': 'LOGIN_REQUIRED'},
                               'cookiePreserved': 'playback_fixture=connected' in self.headers.get('Cookie', '')}).encode()
        elif self.path.startswith('/youtubei/v1/player'):
            body = json.dumps({'adPlacements': [1], 'playerAds': [2], 'adSlots': [3],
                'playabilityStatus': {'status': 'OK'}, 'videoDetails': {'videoId': 'member-fixture'},
                'streamingData': {'formats': [{'url': 'https://media.example/member?signature=unchanged'}]}}).encode()
        else:
            mime = 'text/html; charset=utf-8'
            body = (folder / 'fixture.html').read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Set-Cookie', 'playback_fixture=connected; Path=/; Secure; SameSite=Lax')
        self.end_headers()
        self.wfile.write(body)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(folder / 'certificate.pem', folder / 'key.pem')
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()

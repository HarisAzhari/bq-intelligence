"""Start/open this workspace's server, or stop only its verified instance."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT=Path(__file__).resolve().parent
URL='http://127.0.0.1:8000'

def running():
    try:
        with urllib.request.urlopen(URL+'/api/health',timeout=1) as response:
            return json.load(response)
    except Exception: return None

def owned(server):
    try:
        record=json.loads((ROOT/'data'/'server-instance.json').read_text(encoding='utf8'))
        return record if server and record['instance']==server.get('instance') else None
    except (OSError,ValueError,KeyError): return None

if __name__=='__main__':
    os.chdir(ROOT)
    server=running()
    record=owned(server)
    if len(sys.argv)>1 and sys.argv[1]=='stop':
        if record:
            try:
                os.kill(record['pid'],signal.SIGTERM)
                print('Drawing Atlas stopped. Run start.bat to start it again.')
            except OSError as exc: print('Could not stop the server:',exc)
        else: print('This workspace has no verified running server on port 8000. No process was stopped.')
    elif server:
        if record:
            webbrowser.open(URL)
            print('Drawing Atlas is already running. Opened the app. Use stop.bat before restarting after .env changes.')
        else:
            print('Port 8000 is serving another application or workspace. Stop that server or use the manual launch instructions in README.md.')
    else:
        print('Starting Drawing Atlas at '+URL+'. Keep this window open. Ctrl+C stops the server.',flush=True)
        process=subprocess.Popen([sys.executable,'-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000'],cwd=ROOT)
        try:
            for _ in range(60):
                if process.poll() is not None: break
                if owned(running()):
                    webbrowser.open(URL);break
                time.sleep(.25)
            process.wait()
        except KeyboardInterrupt:
            process.terminate();process.wait()

"""Native WebView2 integration check. Run with the production app closed."""
import sys, os, time, json, subprocess, base64, tempfile, argparse
from pathlib import Path
from urllib.parse import urlparse
import webview
from launch import ensure_server, ROOT
os.environ['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']='--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling'
OUT=ROOT/'.output-test';OUT.mkdir(exist_ok=True)
parser=argparse.ArgumentParser()
parser.add_argument('--viewer',action='store_true')
parser.add_argument('--server-port',type=int)
args=parser.parse_args()
viewer=args.viewer
server=None
if viewer:
    if args.server_port is None or not 1<=args.server_port<=65535:
        parser.error('--viewer requires the main process --server-port')
    base_url=f'http://127.0.0.1:{args.server_port}/'
else:
    for name in ['viewer.json','portrait.json','resize.request','main.json','viewer-error.json']:(OUT/name).unlink(missing_ok=True)
    base_url,server=ensure_server()
url=base_url + ('framework/web/live-view.html?project=avatar-printer' if viewer else 'projects/avatar-printer/index.html')
window=webview.create_window('Output integration '+('viewer' if viewer else 'main'),url,width=1000,height=750)
results=[]
failed=False
def evaluate(code):return window.evaluate_js(code)
def wait(code,timeout=35):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        try:
            result=evaluate(code)
            if result:return result
        except Exception:pass
        time.sleep(.3)
    raise AssertionError('Timed out: '+code)
def run():
    global failed
    child=None
    try:
        wait("document.readyState==='complete'")
        evaluate("['wheel','pointerdown','pointermove','pointerup','keydown','click'].forEach(type=>document.addEventListener(type,e=>{if(e.isTrusted){e.stopImmediatePropagation();e.preventDefault()}},{capture:true,passive:false}))")
        if viewer:
            state=wait("(()=>{const v=document.querySelector('video');return v.readyState>=2&&v.videoWidth?{w:v.videoWidth,h:v.videoHeight}:null})()",50)
            time.sleep(3)
            image=evaluate("(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png')})()")
            (OUT/'frame.png').write_bytes(base64.b64decode(image.split(',')[1]))
            before=evaluate("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
            evaluate("document.querySelector('#interaction').dispatchEvent(new WheelEvent('wheel',{deltaY:320,bubbles:true,cancelable:true,clientX:400,clientY:300}))")
            time.sleep(5)
            after=evaluate("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
            state.update(frames=after-before,canvasCount=evaluate("document.querySelectorAll('canvas').length"))
            assert after>before,'Video frozen'
            (OUT/'viewer.json').write_text(json.dumps(state))
            until=time.monotonic()+30
            while not (OUT/'resize.request').exists() and time.monotonic()<until:time.sleep(.2)
            wait("document.querySelector('video').videoWidth===1080&&document.querySelector('video').videoHeight===1920")
            before=evaluate("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
            time.sleep(5)
            after=evaluate("document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
            assert after>before,'Portrait video froze'
            image=evaluate("(()=>{const v=document.querySelector('video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL('image/png')})()")
            (OUT/'portrait-frame.png').write_bytes(base64.b64decode(image.split(',')[1]))
            (OUT/'portrait.json').write_text(json.dumps({'width':1080,'height':1920,'framesOverFiveSeconds':after-before}))
            time.sleep(15)
        else:
            wait("typeof window.printerDiagnostics==='function'")
            time.sleep(3)
            original=evaluate('window.printerDiagnostics()')
            for aa in ['off','msaa2','msaa4','msaa8','ssaa15','ssaa2']:
                evaluate("(()=>{const s=document.querySelector('#antialias-mode');s.value="+json.dumps(aa)+";s.dispatchEvent(new Event('change'))})()")
                time.sleep(.5)
                state=evaluate('window.printerDiagnostics()');assert all(abs(a-b)<1e-7 for a,b in zip(state['camera'],original['camera'])),{'original':original,'new':state}
                assert state['output']==[1280,720],state
                assert state['internal'][0]<=2560,state
                results.append(state)
            evaluate("(()=>{const s=document.querySelector('#visual-preset');s.value='high';s.dispatchEvent(new Event('change'))})()")
            child=subprocess.Popen([sys.executable,__file__,'--viewer','--server-port',str(urlparse(base_url).port)],cwd=ROOT)
            wait("window.printerDiagnostics().connected==='connected'",50)
            time.sleep(12)
            assert (OUT/'viewer.json').exists(),'Viewer did not produce report'
            assert evaluate("getComputedStyle(document.querySelector('#stage')).display")=='none'
            assert evaluate('window.printerDiagnostics().camera')!=original['camera'],'Wheel did not move camera'
            results.append({'stream':json.loads((OUT/'viewer.json').read_text()),'main':evaluate('window.printerDiagnostics()')})
            evaluate("(()=>{const s=document.querySelector('#output-resolution');s.value='portrait-1080p';s.dispatchEvent(new Event('change'));const fps=document.querySelector('#target-fps');fps.value='30';fps.dispatchEvent(new Event('change'))})()")
            (OUT/'resize.request').write_text('portrait')
            until=time.monotonic()+25
            while not (OUT/'portrait.json').exists() and time.monotonic()<until:time.sleep(.3)
            assert (OUT/'portrait.json').exists(),'Portrait resize did not reach receiver'
            results.append({'portrait':json.loads((OUT/'portrait.json').read_text()),'main':evaluate('window.printerDiagnostics()')})
            assert evaluate('window.printerDiagnostics().output')==[1080,1920]
            errors=evaluate('window.__pageErrors||[]');assert not errors,errors
            child.terminate();child.wait(timeout=10);child=None
            wait("getComputedStyle(document.querySelector('#stage')).display!=='none'",20)
            results.append({'restored':True})
        (OUT/('viewer-done.json' if viewer else 'main.json')).write_text(json.dumps({'ok':True,'results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    except Exception as e:
        failed=True
        (OUT/('viewer-error.json' if viewer else 'main.json')).write_text(json.dumps({'ok':False,'error':str(e),'results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        if child:child.terminate()
        window.destroy()
webview.start(run,gui='edgechromium',private_mode=False,storage_path=tempfile.mkdtemp(prefix='printer-output-'+('viewer' if viewer else 'main')))
if server:
    server.shutdown()
    server.server_close()

sys.exit(1 if failed else 0)

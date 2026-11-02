// No visible windows, no production profiles, no real live-room connection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const browserPath=[
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);
if(!browserPath)throw Error('Headless Chromium is required for this integration check');
const python=existsSync(path.join(root,'.venv','Scripts','python.exe'))?path.join(root,'.venv','Scripts','python.exe'):'python';
const out=path.join(root,'.runtime-tmp','framework-browser-'+Date.now());mkdirSync(out,{recursive:true});
const server=spawn(python,['-u',path.join(root,'tests','framework_browser_server.py')],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
let browser,protocol;
const sessions=[],failures=[],screenshots=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label,timeout=35000)=>{const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await delay(150)}throw Error('Timed out: '+label)};

function connect(url){
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url);let next=0;const pending=new Map();
    ws.onopen=()=>resolve({ws,call:(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method))},15000);
      pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    })});
    ws.onerror=reject;
    ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);return}
      const session=sessions.find(item=>item.sessionId===message.sessionId);if(!session)return;
      if(message.method==='Runtime.exceptionThrown')session.errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
      if(message.method==='Network.responseReceived'&&message.params.response.status>=400)session.requests.push(message.params.response.status+' '+message.params.response.url);
    };
  });
}
async function evaluate(session,expression){const result=await protocol.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session.sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
async function open(url){const {targetId}=await protocol.call('Target.createTarget',{url:'about:blank'});const {sessionId}=await protocol.call('Target.attachToTarget',{targetId,flatten:true});const session={targetId,sessionId,errors:[],requests:[]};sessions.push(session);await protocol.call('Runtime.enable',{},sessionId);await protocol.call('Network.enable',{},sessionId);await protocol.call('Page.enable',{},sessionId);await protocol.call('Page.navigate',{url},sessionId);return session}
async function screenshot(session,name){const {data}=await protocol.call('Page.captureScreenshot',{format:'png'},session.sessionId);const file=path.join(out,name+'.png');writeFileSync(file,Buffer.from(data,'base64'));screenshots.push(file)}
async function close(session){await protocol.call('Target.closeTarget',{targetId:session.targetId});}

try{
  const base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Test HTTP server did not start')),15000);server.stdout.on('data',chunk=>{text+=chunk;const found=text.match(/TEST_URL=(http:\/\/[^\s]+)/);if(found){clearTimeout(timer);resolve(found[1])}});server.once('exit',code=>reject(Error('Test server exited '+code)));});
  let endpoint='';browser=spawn(browserPath,['--headless=new','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+path.join(out,'profile'),'--no-first-run','--no-default-browser-check','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--autoplay-policy=no-user-gesture-required','--window-size=1280,900','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  browser.stderr.on('data',chunk=>{const found=String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);if(found)endpoint=found[1]});
  await until(()=>endpoint,'headless debug endpoint',15000);protocol=await connect(endpoint);
  const hub=await open(base);await until(()=>evaluate(hub,"document.querySelectorAll('.project-card').length===2"),'project center cards');await screenshot(hub,'project-center');
  const printer=await open(base+'projects/avatar-printer/index.html');await until(()=>evaluate(printer,"typeof printerDiagnostics==='function'&&printerDiagnostics().rendererCount===1"),'Chinese printer initialization');
  await evaluate(printer,"(()=>{const x=document.querySelector('#output-resolution');x.value='portrait';x.dispatchEvent(new Event('change'))})()");
  const originalCamera=await evaluate(printer,'printerDiagnostics().camera');
  const viewer=await open(base+'framework/web/live-view.html?project=avatar-printer');
  await until(()=>evaluate(viewer,"(()=>{const v=document.querySelector('video');return v.readyState>=2&&v.videoWidth===720&&v.videoHeight===1280})()"),'printer mirrored video',50000);
  await until(()=>evaluate(viewer,"getComputedStyle(document.querySelector('#interaction')).display==='block'"),'optional 3D controls');
  await delay(500);
  const mirroredCamera=await evaluate(printer,'printerDiagnostics().camera');
  assert(mirroredCamera.every((value,index)=>Math.abs(value-originalCamera[index])<1e-6),'opening the shared viewer changed the project camera');
  const frames=await evaluate(viewer,"document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames");await delay(1000);assert(await evaluate(viewer,"document.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")>frames,'printer mirror froze');
  await screenshot(viewer,'printer-output');
  await evaluate(viewer,"document.querySelector('#interaction').dispatchEvent(new WheelEvent('wheel',{deltaY:200,bubbles:true,cancelable:true,clientX:500,clientY:400}))");
  await until(async()=>{const position=await evaluate(printer,'printerDiagnostics().camera');return position.some((value,index)=>Math.abs(value-originalCamera[index])>.01)},'camera input roundtrip');
  const starter=await open(base+'projects/starter/index.html');await until(()=>evaluate(starter,"typeof projectDiagnostics==='function'"),'2D project initialization');
  await evaluate(starter,"document.querySelector('[data-demo=gift]').click()");assert.equal(await evaluate(starter,'projectDiagnostics().eventCount'),1);
  const starterView=await open(base+'framework/web/live-view.html?project=starter');await until(()=>evaluate(starterView,"document.querySelector('video').readyState>=2&&document.querySelector('video').videoWidth===720"),'2D mirrored video');
  assert.equal(await evaluate(starterView,"getComputedStyle(document.querySelector('#interaction')).display"),'none');
  assert.equal(await evaluate(starterView,"performance.getEntriesByType('resource').some(e=>/three.module|OrbitControls/.test(e.name))"),false,'2D viewer loaded 3D engine');
  assert.equal(await evaluate(printer,'printerDiagnostics().output[0]'),720);
  await evaluate(starter,"(()=>{const x=document.querySelector('#orientation');x.value='landscape';x.dispatchEvent(new Event('change'))})()");
  await until(()=>evaluate(starterView,"document.querySelector('video').videoWidth===1280&&document.querySelector('video').videoHeight===720"),'2D resize');
  assert.equal(await evaluate(viewer,"document.querySelector('video').videoWidth"),720,'2D resize leaked into printer output');
  await screenshot(starter,'starter');await screenshot(starterView,'starter-output');
  await close(viewer);await until(()=>evaluate(printer,"getComputedStyle(document.querySelector('#stage')).display!=='none'"),'printer recovery after viewer close',20000);await close(printer);
  const english=await open(base+'projects/avatar-printer/index-en.html');await until(()=>evaluate(english,"typeof printerDiagnostics==='function'&&printerDiagnostics().rendererCount===1"),'English printer initialization');await screenshot(english,'printer-english');
  for(const session of sessions){if(session.errors.length||session.requests.length)failures.push({target:session.targetId,errors:session.errors,requests:session.requests})}
  assert.deepEqual(failures,[],'runtime exceptions or missing resources');
  writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,checks:['project center discovery','Chinese and English printer','printer WebRTC output and recovery','independent 2D event handling and output','project-scoped preferences and output resize','2D viewer without Three.js'],screenshots},null,2));
  console.log('PASS project center, printer zh/en, 2D project, live output, isolation, resources');console.log('Report: '+path.join(out,'result.json'));
}catch(error){writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:false,error:String(error),failures,sessions,screenshots},null,2));throw error}
finally{if(protocol){try{await protocol.call('Browser.close')}catch{}protocol.ws.close()}browser?.kill();server.kill()}

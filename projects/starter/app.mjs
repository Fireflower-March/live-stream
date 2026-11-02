import {createProjectStorage, projectViewerUrl} from '/framework/web/project-context.mjs';
import {DesktopClient} from '/framework/web/desktop-client.mjs';
import {LiveClient} from '/framework/web/live-client.mjs';
import {SceneChannel} from '/framework/web/scene-channel.mjs';
import {OutputStream} from '/framework/web/output-stream.mjs';
import {ProjectSession} from '/framework/web/project-session.mjs';

const projectId = 'starter';
const storage = createProjectStorage(projectId);
const host = new DesktopClient(projectId);
const channel = new SceneChannel({projectId});
const session = new ProjectSession({channel});
const $ = id => document.getElementById(id);
const canvas = $('output'), context = canvas.getContext('2d');
const sizes = {portrait:[720,1280],'portrait-1080p':[1080,1920],landscape:[1280,720],'landscape-1080p':[1920,1080]};
let orient = storage.getItem('orientation') || 'portrait';
if (!sizes[orient]) orient = 'portrait';
let targetFps = Number(storage.getItem('fps')) === 60 ? 60 : 30;
let latest = {type:'idle', name:'等待互动', text:'评论、点赞和礼物，在这里产生反馈。'};
let eventCount = 0, changedAt = performance.now(), frameAt = 0;
const events = [];
const output = new OutputStream({channel, getStream:()=>canvas.captureStream(0), getFrameRate:()=>targetFps, isActive:()=>session.isLeader(),
  onDetached:detached=>{$('popout').textContent=detached?'直播小窗已连接':'弹出画面'},
  onStats:stats=>{$('output-status').textContent=`实际解码 ${stats.fps} FPS · ${stats.width}×${stats.height}`},
  onerror:error=>{$('output-status').textContent='画面连接：'+error.message},
});
channel.onmessage = event => { if(!session.handleMessage(event.data))output.handleMessage(event.data); };

function resize() {
  [canvas.width, canvas.height] = sizes[orient];
  storage.setItem('orientation', orient);
  channel.postMessage({type:'view-size',width:canvas.width,height:canvas.height});
}
function receive(message) {
  if (!['comment','like','gift','join','follow'].includes(message.type)) return;
  const titles = {comment:'评论',like:'点赞',gift:'礼物',join:'进场',follow:'关注'};
  latest = {type:message.type, name:String(message.name||message.nickname||'直播观众').slice(0,24),
    text:message.type==='gift'?`${message.raw||message.gift||'礼物'} × ${message.count||1}`:String(message.text||titles[message.type]).slice(0,50)};
  eventCount++;
  changedAt = performance.now();
  events.unshift(`${latest.name} · ${titles[latest.type]} · ${latest.text}`);
  events.length = Math.min(events.length,12);
  $('events').replaceChildren(...events.map(text=>{const item=document.createElement('li');item.textContent=text;return item}));
}
const live = new LiveClient({onopen:()=>{$('status').textContent='● 直播数据已连接'},
  onclose:()=>{$('status').textContent='本地演示 · 数据桥已断开'},onmessage:receive});
live.connect();

function draw(now) {
  if (now-frameAt < 1000/targetFps-.5) return;
  frameAt=now;
  const w=canvas.width,h=canvas.height,unit=Math.min(w,h),cx=w/2,cy=h*.43;
  const colors={idle:'#67cbbb',comment:'#67b7ff',like:'#f0a6c1',gift:'#ffd681',join:'#b4a4ff',follow:'#b4a4ff'};
  const color=colors[latest.type]||colors.idle;
  const gradient=context.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'#102c3e');gradient.addColorStop(1,'#101525');
  context.fillStyle=gradient;context.fillRect(0,0,w,h);
  context.save();context.translate(cx,cy);context.rotate(now/18000);
  for(let i=0;i<3;i++){context.strokeStyle=color;context.globalAlpha=.16+i*.08;context.lineWidth=unit*.003;context.beginPath();context.ellipse(0,0,unit*(.23+i*.07),unit*(.15+i*.07),i*.9,0,Math.PI*2);context.stroke()}
  context.restore();
  const pulse=Math.max(0,1-(now-changedAt)/1200);context.fillStyle=color;context.globalAlpha=.8;context.beginPath();context.arc(cx,cy,unit*(.06+pulse*.035),0,Math.PI*2);context.fill();context.globalAlpha=1;
  context.textAlign='center';context.fillStyle='#97b8cc';context.font=`${unit*.026}px sans-serif`;context.fillText('LIVE INTERACTION / STARTER',cx,h*.13);
  context.fillStyle='#f0f7fc';context.font=`bold ${unit*.06}px sans-serif`;context.fillText(latest.name,cx,h*.65, w*.88);
  context.fillStyle=color;context.font=`${unit*.032}px sans-serif`;context.fillText(latest.text,cx,h*.72,w*.88);
  context.fillStyle='#8da8be';context.font=`${unit*.023}px sans-serif`;context.fillText(`已接收 ${eventCount} 次互动`,cx,h*.9);
  output.requestFrame();
}
let animationFrame;
function tick(now) { animationFrame=requestAnimationFrame(tick);draw(now); }
// A browser popup can hide its controller tab; keep supplying frames to its viewer.
const backgroundFrames=setInterval(()=>{if(document.hidden&&output.active)draw(performance.now())},1000/60);
$('orientation').value=orient;$('fps').value=String(targetFps);resize();animationFrame=requestAnimationFrame(tick);
$('orientation').onchange=()=>{orient=$('orientation').value;resize()};
$('fps').onchange=()=>{targetFps=Number($('fps').value);storage.setItem('fps',targetFps);output.setFrameRate(targetFps)};
$('popout').onclick=async()=>{try{$('output-status').textContent=await host.openOutput(orient)}catch(error){$('output-status').textContent=error.message}};
for(const button of document.querySelectorAll('[data-demo]')) button.onclick=()=>receive({type:button.dataset.demo,name:'演示观众',text:'你好，新项目！',raw:'小心心',count:1});
$('room').value=storage.getItem('room')||'';
for(const [id,method] of [['open-room','openLiveRoom'],['start-capture','startCapture'],['stop-capture','stopCapture']]) {
  $(id).onclick=async()=>{const button=$(id);button.disabled=true;try{storage.setItem('room',$('room').value);$('host-status').textContent=await host[method]($('room').value);if(method==='startCapture')live.connect()}catch(error){$('host-status').textContent=error.message}finally{button.disabled=false}};
}
$('home').onclick=async event=>{event.preventDefault();try{location.assign(await host.projectUrl())}catch(error){$('host-status').textContent=error.message}};
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
window.addEventListener('pagehide',()=>{clearInterval(backgroundFrames);cancelAnimationFrame(animationFrame);live.close();output.close();session.close();channel.close()},{once:true});
// Introspection for automated integration checks; contains no control of other projects.
window.projectDiagnostics=()=>({projectId,eventCount,output:[canvas.width,canvas.height],targetFps,connection:output.connectionState,viewer:projectViewerUrl(projectId)});

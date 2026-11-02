import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OutputStream} from './framework/web/output-stream.mjs';

const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Peer {
  static instances=[];
  constructor(){this.connectionState='new';this.candidates=[];this.tracks=[];this.params={encodings:[{}]};this.sender={getParameters:()=>this.params,setParameters:async p=>this.params=p};Peer.instances.push(this);}
  createDataChannel(){return this.input={};}
  addTrack(track){this.tracks.push(track);}
  getSenders(){return[this.sender];}
  getTransceivers(){return[{setCodecPreferences:codecs=>this.codecs=codecs}];}
  async createOffer(){return{type:'offer',sdp:'test-offer'};}
  async setLocalDescription(sdp){this.localDescription=sdp;}
  async setRemoteDescription(sdp){this.remoteDescription=sdp;this.connectionState='connected';}
  async addIceCandidate(candidate){this.candidates.push(candidate);}
  close(){this.connectionState='closed';}
}
function publisher(options={}){
  let stopped=0,frames=0,watchdog;
  const track={stop:()=>stopped++,requestFrame:()=>frames++};
  const stream={getVideoTracks:()=>[track],getTracks:()=>[track]};
  const messages=[];
  const output=new OutputStream({channel:{postMessage:m=>messages.push(m)},getStream:()=>stream,
    PeerConnectionImpl:Peer,RtpSenderImpl:{getCapabilities:()=>({codecs:[{mimeType:'video/vp8'},{mimeType:'video/H264'}]})},
    setIntervalImpl:fn=>(watchdog=fn,1),clearIntervalImpl:()=>{},...options});
  return{output,track,messages,watchdog:()=>watchdog(),get stopped(){return stopped;},get frames(){return frames;}};
}

test('any project canvas stream can negotiate at its frame rate without depending on Three.js',async()=>{
  const p=publisher({getFrameRate:()=>60});
  assert.equal(p.output.handleMessage({type:'who'}),false);
  assert.equal(p.output.handleMessage({type:'view-request'}),true);await settle();
  assert.equal(p.messages.at(-1).type,'view-offer');
  assert.equal(p.output.pc.params.encodings[0].maxFramerate,60);
  assert.equal(p.output.pc.params.encodings[0].maxBitrate,40000000);
  assert.equal(p.output.pc.codecs[0].mimeType,'video/H264');
  assert.equal(p.frames,1,'static sources receive an initial frame request');
  p.output.requestFrame();assert.equal(p.frames,2);
  await p.output.setFrameRate(30);assert.equal(p.output.pc.params.encodings[0].maxFramerate,30);
  p.output.close();assert.equal(p.stopped,1);assert.equal(p.output.connectionState,'closed');
});

test('ICE arriving before the answer is retained and flushed when the remote description is set',async()=>{
  const p=publisher();p.output.handleMessage({type:'view-request'});await settle();
  p.output.handleMessage({type:'view-ice',candidate:{candidate:'early'}});
  assert.equal(p.output.pendingIce.length,1);
  p.output.handleMessage({type:'view-answer',sdp:{type:'answer',sdp:'answer'}});await settle();
  assert.deepEqual(p.output.pc.candidates,[{candidate:'early'}]);
  assert.equal(p.output.connectionState,'connected');p.output.close();
});

test('camera interaction is an optional project callback and view readiness controls detach state',async()=>{
  let requested=0,changed,stats;const detached=[];
  const p=publisher({onCameraRequest:()=>requested++,onCameraChange:m=>changed=m,onStats:m=>stats=m,onDetached:value=>detached.push(value)});
  p.output.handleMessage({type:'view-ping'});assert.deepEqual(detached,[],'a follower without a stream must not hide its scene');
  p.output.handleMessage({type:'view-request'});await settle();
  p.output.handleMessage({type:'view-ready'});assert.equal(detached.at(-1),true);
  p.output.handleMessage({type:'view-camera-request'});assert.equal(requested,1);
  p.output.pc.input.onmessage({data:'{"type":"view-camera-change","p":[1,2,3]}'});assert.deepEqual(changed.p,[1,2,3]);
  p.output.handleMessage({type:'view-stats',fps:59});assert.equal(stats.fps,59);
  p.output.handleMessage({type:'view-bye'});assert.equal(detached.at(-1),false);assert.equal(p.stopped,1);p.output.close();
});

test('only active project instances publish, and heartbeat loss frees resources',async()=>{
  let now=0;const states=[];
  const follower=publisher({isActive:()=>false});follower.output.handleMessage({type:'view-request'});await settle();
  assert.equal(follower.output.pc,null);follower.output.close();
  const p=publisher({now:()=>now,onConnectionChange:state=>states.push(state)});
  p.output.handleMessage({type:'view-request'});await settle();now=13000;p.watchdog();
  assert.deepEqual(states,[true,false]);assert.equal(p.output.active,false);assert.equal(p.stopped,1);p.output.close();
});

test('failed negotiation reports an error and returns to the project scene',async()=>{
  class FailingPeer extends Peer {async createOffer(){throw Error('unsupported codec');}}
  const errors=[],detached=[];const p=publisher({PeerConnectionImpl:FailingPeer,onerror:e=>errors.push(e),onDetached:value=>detached.push(value)});
  p.output.handleMessage({type:'view-request'});await settle();
  assert.equal(errors[0].message,'unsupported codec');assert.equal(p.output.active,false);assert.equal(p.stopped,1);assert.equal(detached.at(-1),false);
  p.output.close();assert.equal(p.output.handleMessage({type:'view-request'}),false);
});

test('closing while an asynchronous source is loading releases its tracks without publishing',async()=>{
  let provide,stopped=0;
  const source=new Promise(resolve=>provide=resolve);
  const p=publisher({getStream:()=>source});
  p.output.handleMessage({type:'view-request'});await settle();p.output.close();
  const track={stop:()=>stopped++};provide({getTracks:()=>[track],getVideoTracks:()=>[track]});await settle();
  assert.equal(stopped,1);assert.equal(p.messages.length,0);assert.equal(p.output.active,false);
});

test('overlapping viewer requests share one source and only publish the newest negotiation',async()=>{
  let provide,calls=0,stopped=0;
  const source=new Promise(resolve=>provide=resolve);
  const p=publisher({getStream:()=>{calls++;return source;}});
  p.output.handleMessage({type:'view-request'});p.output.handleMessage({type:'view-request'});await settle();
  const track={stop:()=>stopped++};provide({getTracks:()=>[track],getVideoTracks:()=>[track]});await settle();
  assert.equal(calls,1);assert.equal(p.messages.filter(m=>m.type==='view-offer').length,1);
  p.output.close();assert.equal(stopped,1);
});

test('default browser interval functions retain the global receiver during cleanup', t=>{
  let cleared;
  t.mock.method(globalThis,'setInterval',function(){assert.equal(this,globalThis,'Window.setInterval receiver');return 42;});
  t.mock.method(globalThis,'clearInterval',function(id){assert.equal(this,globalThis,'Window.clearInterval receiver');cleared=id;});
  const output=new OutputStream({channel:{postMessage(){}},getStream:()=>null});
  output.close();assert.equal(cleared,42);
});

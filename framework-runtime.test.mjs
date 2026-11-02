import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveProjectId, createProjectStorage, projectViewerUrl, fetchProject} from './framework/web/project-context.mjs';
import {SceneChannel} from './framework/web/scene-channel.mjs';
import {LiveClient} from './framework/web/live-client.mjs';

const settle = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {getItem:key=>entries.get(key)??null, setItem:(key,value)=>entries.set(key,String(value)), removeItem:key=>entries.delete(key)};
}

test('project identity is explicit or page-scoped, rejects unsafe ids, and builds shared viewer URL', () => {
  const document = {querySelector:()=>({content:'starter'})};
  const location = {search:'?project=avatar-printer'};
  assert.equal(resolveProjectId({document,location}), 'starter');
  assert.equal(resolveProjectId({projectId:'other',document,location}), 'other');
  assert.equal(resolveProjectId({document:null,location}), 'avatar-printer');
  assert.equal(projectViewerUrl('starter'), '/framework/web/live-view.html?project=starter');
  for(const projectId of ['../private','bad?id=1','','hello world']) assert.throws(()=>resolveProjectId({projectId}));
});

test('project preferences remain isolated and legacy migration requires an explicit key allowlist', () => {
  const storage = memoryStorage({'printer-orient':'portrait',printRules:'{"gift":true}'});
  const printer = createProjectStorage('avatar-printer',storage,{legacyKeys:['printer-orient']});
  const starter = createProjectStorage('starter',storage);
  assert.equal(printer.getItem('printer-orient'),'portrait');
  assert.equal(printer.getItem('printRules'),null);
  assert.equal(starter.getItem('printer-orient'),null);
  starter.setItem('printer-orient','landscape');
  assert.equal(printer.getItem('printer-orient'),'portrait');
  assert.equal(starter.getItem('printer-orient'),'landscape');
  starter.setJSON('settings',{fps:60});assert.deepEqual(starter.getJSON('settings'),{fps:60});
  starter.removeItem('settings');assert.deepEqual(starter.getJSON('settings',{}),{});
  assert.equal(storage.getItem('printer-orient'),'portrait','migration preserves the old key for rollback');
});

test('project metadata comes from the registry and unknown projects fail clearly', async () => {
  const fetchImpl = async () => ({ok:true,json:async()=>({projects:[{id:'starter',name:'Example'}],errors:[]})});
  assert.equal((await fetchProject('starter',fetchImpl)).name,'Example');
  await assert.rejects(fetchProject('unknown',fetchImpl),/Unknown project/);
});

class LocalBroadcast {
  static peers = new Set();
  constructor(name) {this.name=name;LocalBroadcast.peers.add(this);}
  postMessage(data) {for(const peer of LocalBroadcast.peers)if(peer!==this&&peer.name===this.name)peer.onmessage?.({data});}
  close(){LocalBroadcast.peers.delete(this);}
}
function scene(projectId,fetchImpl=async()=>({ok:true})) {
  return new SceneChannel({projectId,fetchImpl,BroadcastChannelImpl:LocalBroadcast,cryptoImpl:{randomUUID:()=>projectId+'-client'},autoPoll:false});
}

test('peer election messages cannot cross between projects in the same browser origin', async () => {
  const a = scene('avatar-printer'), same = scene('avatar-printer'), b = scene('starter');
  const seenA=[],seenB=[];same.onmessage=e=>seenA.push(e.data);b.onmessage=e=>seenB.push(e.data);
  await a.postMessage({type:'who',sid:'main'});
  assert.equal(seenA.length,1);assert.equal(seenB.length,0);
  a.close();same.close();b.close();
  assert.equal(LocalBroadcast.peers.size,0);
});

test('isolated process signalling publishes the project id and retries a failed queued message', async () => {
  const calls=[];let fail=true;
  const channel = scene('starter',async(url,options)=>{calls.push({url,options});if(fail)throw Error('offline');return{ok:true};});
  await channel.postMessage({type:'view-request'});assert.equal(channel.pending.length,1);
  channel.available=true;await channel.postMessage(channel.pending.shift());
  assert.equal(channel.pending.length,1);assert.equal(channel.available,false);
  fail=false;channel.available=true;await channel.postMessage(channel.pending.shift());
  assert.equal(channel.pending.length,0);
  assert.equal(JSON.parse(calls[1].options.body).project,'starter');
  assert.equal(JSON.parse(calls[1].options.body).message.type,'view-request');
  channel.close();assert.equal(await channel.postMessage({type:'view-request'}),false);
});

test('long-poll URLs include project and cursor; closing aborts an outstanding poll', async () => {
  const calls=[];let requests=0;
  const channel = scene('starter',async(url,{signal})=>{
    calls.push(url);
    if(++requests===1)return{ok:true,json:async()=>({cursor:4,messages:[{type:'view-ready'}]})};
    return await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
  });
  const messages=[];channel.onmessage=e=>messages.push(e.data.type);
  const polling=channel.poll();await settle();channel.close();await polling;
  assert.deepEqual(messages,['view-ready']);
  assert.equal(new URL(calls[0],'http://localhost').searchParams.get('project'),'starter');
  assert.equal(new URL(calls[1],'http://localhost').searchParams.get('after'),'4');
  assert.equal(channel.closed,true);
});

class FakeSocket {
  static instances=[];
  constructor(url){this.url=url;this.readyState=0;this.sent=[];FakeSocket.instances.push(this);}
  send(message){this.sent.push(message);}
  close(){this.readyState=3;this.onclose?.({code:1000});}
  open(){this.readyState=1;this.onopen?.({type:'open'});}
}
function fakeTimers(){let next=0;const tasks=new Map();return {tasks,set:(fn,delay)=>{const id=++next;tasks.set(id,{fn:()=>{tasks.delete(id);fn();},delay});return id;},clear:id=>tasks.delete(id)};}

test('shared live client discovers once, delivers parsed payloads, and sends control messages', async () => {
  FakeSocket.instances=[];const timers=fakeTimers();let discoveries=0,opened,received;
  const errors=[];
  const client=new LiveClient({fetchImpl:async()=>{discoveries++;return{ok:true,json:async()=>({ok:true,url:'ws://127.0.0.1:8766'})};},WebSocketImpl:FakeSocket,
    setTimeoutImpl:timers.set,clearTimeoutImpl:timers.clear,onopen:(event,owner)=>opened=owner,
    onmessage:data=>received=data,onerror:error=>errors.push(error)});
  await Promise.all([client.connect(),client.connect()]);
  assert.equal(discoveries,1);assert.equal(FakeSocket.instances.length,1);
  client.socket.open();assert.equal(opened,client);
  client.socket.onmessage({data:'{"type":"gift","count":2}'});assert.equal(received.count,2);
  client.socket.onmessage({data:'invalid'});assert.equal(errors.length,1);
  assert.equal(client.send({type:'set-room',room:'12345'}),true);
  assert.deepEqual(JSON.parse(client.socket.sent[0]),{type:'set-room',room:'12345'});
  client.close();assert.equal(timers.tasks.size,0);assert.equal(client.send({}),false);
});

test('bridge loss reconnects, while manual disconnect stops reconnect and ignores stale socket callbacks', async () => {
  const timers=fakeTimers();const statuses=[];
  const client=new LiveClient({fetchImpl:async()=>({ok:true,json:async()=>({ok:true,url:'ws://local'})}),WebSocketImpl:FakeSocket,
    setTimeoutImpl:timers.set,clearTimeoutImpl:timers.clear,onstatus:status=>statuses.push(status)});
  await client.connect();const old=client.socket;old.open();old.close();
  assert.equal(timers.tasks.size,1);
  const retry=[...timers.tasks.values()][0];retry.fn();await settle();
  assert.notEqual(client.socket,old);
  const stale=client.socket.onclose;client.disconnect();stale({code:1006});
  assert.equal(client.socket,null);assert.equal(timers.tasks.size,0);
  assert.ok(statuses.includes('disconnected'));assert.equal(statuses.at(-1),'stopped');
});

test('offline discovery invokes project auto-start hook and closed clients cannot restart', async () => {
  const timers=fakeTimers();let starts=0;
  const client=new LiveClient({fetchImpl:async()=>({ok:true,json:async()=>({ok:false})}),WebSocketImpl:FakeSocket,
    setTimeoutImpl:timers.set,clearTimeoutImpl:timers.clear,onUnavailable:()=>starts++});
  await client.connect();assert.equal(starts,1);assert.equal(timers.tasks.size,1);
  client.close();await client.connect();assert.equal(starts,1);assert.equal(timers.tasks.size,0);
});

test('disconnect cancels an in-flight bridge health request without scheduling a retry', async () => {
  const timers=fakeTimers();let requestSignal;
  const client=new LiveClient({fetchImpl:async(url,{signal})=>{requestSignal=signal;return await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));},
    setTimeoutImpl:timers.set,clearTimeoutImpl:timers.clear,WebSocketImpl:FakeSocket});
  const pending=client.connect();client.disconnect();await pending;
  assert.equal(requestSignal.aborted,true);assert.equal(client.connecting,false);assert.equal(timers.tasks.size,0);
});

test('default browser fetch and timeout functions retain the global receiver', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',function(url){
    assert.equal(this,globalThis,'Window.fetch requires a Window receiver');calls.push(url);
    return Promise.resolve({ok:true,json:async()=>url==='/__projects'?{projects:[{id:'starter'}]}:{ok:true,url:'ws://local'}});
  });
  t.mock.method(globalThis,'setTimeout',function(){assert.equal(this,globalThis,'Window.setTimeout receiver');return 1;});
  t.mock.method(globalThis,'clearTimeout',function(){assert.equal(this,globalThis,'Window.clearTimeout receiver');});
  const client=new LiveClient({WebSocketImpl:FakeSocket});await client.connect();client.close();
  const channel=new SceneChannel({projectId:'starter',BroadcastChannelImpl:LocalBroadcast,cryptoImpl:{randomUUID:()=> 'receiver-test'},autoPoll:false});
  channel.available=true;await channel.postMessage({type:'view-request'});channel.close();
  assert.equal((await fetchProject('starter')).id,'starter');
  assert.deepEqual(calls,['/__bridge-status','/__scene-message','/__projects']);
});

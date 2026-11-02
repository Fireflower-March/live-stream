import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSession} from './framework/web/project-session.mjs';

function session({sid = 'self', born = 1000, priority = 0, onChange} = {}) {
  let timestamp = born, tick, cleared = 0;
  const messages = [], channel = {postMessage:message=>messages.push(message)};
  const instance = new ProjectSession({channel, priority, onChange, now:()=>timestamp,
    cryptoImpl:{randomUUID:()=>sid}, setIntervalImpl:(callback, ms)=>{assert.equal(ms,2000);tick=callback;return 42;},
    clearIntervalImpl:timer=>{assert.equal(timer,42);cleared++;}});
  return {instance, messages, channel, tick:()=>tick(), time:value=>timestamp=value,
    get cleared(){return cleared;}};
}

test('announces immediately and periodically without replacing the channel listener',()=>{
  const p=session();
  assert.deepEqual(p.messages[0],{type:'who',sid:'self',born:1000,priority:0,scene:false});
  p.tick();assert.equal(p.messages.length,2);
  assert.equal(p.instance.isLeader(),true);
  assert.equal(p.channel.onmessage,undefined);
  assert.equal(p.instance.handleMessage({type:'view-request'}),false);
});

test('older controller wins; equal birth times converge using session ids',()=>{
  const p=session();
  p.instance.handleMessage({type:'who',sid:'younger',born:1100});
  assert.equal(p.instance.isLeader(),true);
  p.instance.handleMessage({type:'who',sid:'older',born:900});
  assert.equal(p.instance.isLeader(),false);
  const tied=session({sid:'b'});
  tied.instance.handleMessage({type:'who',sid:'a',born:1000,priority:0});
  assert.equal(tied.instance.isLeader(),false);
});

test('scene priority wins over age and supports old who messages',()=>{
  const p=session({born:1});
  p.instance.handleMessage({type:'who',sid:'scene',born:5000,scene:true});
  assert.equal(p.instance.isLeader(),false);
  const scene=session({born:5000,priority:1});
  scene.instance.handleMessage({type:'who',sid:'ordinary',born:1,priority:0});
  assert.equal(scene.instance.isLeader(),true);
});

test('unknown peers receive a reply once and heartbeats do not flood replies',()=>{
  const changes=[],p=session({onChange:(leader,current)=>changes.push([leader,current.peers.size])});
  const who={type:'who',sid:'peer',born:900,priority:0};
  assert.equal(p.instance.handleMessage(who),true);
  assert.equal(p.messages.length,2);
  p.instance.handleMessage(who);assert.equal(p.messages.length,2);
  assert.deepEqual(changes,[[false,1]]);
});

test('fresh heartbeats retain leadership, silent peers expire after six seconds',()=>{
  const changes=[],p=session({onChange:leader=>changes.push(leader)});
  const who={type:'who',sid:'older',born:1};
  p.instance.handleMessage(who);
  p.time(6500);p.instance.handleMessage(who);
  p.time(12500);p.tick();assert.equal(p.instance.isLeader(),false);
  p.time(12501);p.tick();assert.equal(p.instance.isLeader(),true);
  assert.equal(p.instance.peers.size,0);
  assert.deepEqual(changes,[false,true]);
});

test('two controllers converge immediately after the new peer announcement',()=>{
  const queue=[],members=[];
  function create(sid,born){
    const member={};
    const channel={postMessage:message=>queue.push([member,message])};
    member.instance=new ProjectSession({channel,now:()=>born,cryptoImpl:{randomUUID:()=>sid},
      setIntervalImpl:()=>1,clearIntervalImpl:()=>{}});
    members.push(member);return member.instance;
  }
  const first=create('first',1000);
  queue.length=0; // No listener existed when the first page opened.
  const second=create('second',2000);
  let deliveries=0;
  while(queue.length){
    assert.ok(deliveries++<10,'peer replies must terminate');
    const [sender,message]=queue.shift();
    for(const member of members)if(member!==sender)member.instance.handleMessage(message);
  }
  assert.equal(first.isLeader(),true);assert.equal(second.isLeader(),false);
  first.close();second.close();
});

test('malformed and self announcements cannot suppress a session',()=>{
  const p=session();
  for(const message of [{type:'who',sid:'self',born:0,priority:999},
    {type:'who',sid:'bad',born:'0'}, {type:'who',sid:'bad',born:0,priority:NaN},
    {type:'who',sid:'',born:0}])p.instance.handleMessage(message);
  assert.equal(p.instance.peers.size,0);assert.equal(p.instance.isLeader(),true);
});

test('close cancels election work but leaves the shared channel to its owner',()=>{
  const p=session();
  p.instance.close();p.instance.close();
  assert.equal(p.cleared,1);assert.equal(p.instance.isLeader(),false);
  assert.equal(p.instance.handleMessage({type:'who',sid:'other',born:0}),false);
  p.tick();assert.equal(p.messages.length,1);
  assert.equal(p.channel.closed,undefined);
});

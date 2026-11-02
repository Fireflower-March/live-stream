import {test} from 'node:test';import assert from 'node:assert/strict';import {DemoRules} from './projects/avatar-printer/demo-rules.mjs';
for(const [type,count,size] of [['like',1,'small'],['heart',1,'large'],['beer',2,'large'],['lollipop',3,'large']])test(type+'数量与尺寸',()=>{let r=new DemoRules();r.event(type,{name:'测试'},'1');assert.equal(r.queue.length,count);assert.ok(r.queue.every(x=>x.size===size))});
test('事件去重',()=>{let r=new DemoRules();for(let i=0;i<2;i++)r.event('beer',{name:'测试'},'same');assert.equal(r.queue.length,2)});
test('拒绝旧规则',()=>{let r=new DemoRules();assert.throws(()=>r.event('small66',{name:'测试'},'1'))});
test('礼物优先于普通任务，礼物之间保持先来先打印',()=>{
 const r=new DemoRules();
 r.event('like',{name:'普通A'},'a');r.event('like',{name:'普通B'},'b');
 const first=r.event('beer',{name:'礼物A'},'gift-a');
 const second=r.event('heart',{name:'礼物B'},'gift-b');
 assert.deepEqual(r.queue.map(j=>j.name),['礼物A','礼物A','礼物B','普通A','普通B']);
 assert.equal(first.index,0);assert.equal(second.index,2);
});
test('插队任务的直播标记不污染普通队列，重连后仍保留礼物',()=>{
 const r=new DemoRules();r.event('like',{name:'演示'},'demo');
 const result=r.event('lollipop',{name:'礼物'},'gift');
 for(let i=result.index;i<result.index+result.added;i++){r.queue[i].live=true;r.queue[i].source='礼物·棒棒糖'}
 assert.equal(r.queue.at(-1).live,undefined);
 assert.equal(r.queue.filter(j=>j.live).length,3);
 assert.ok(result.jobs.every(j=>j.priority&&j.live));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DesktopClient,normalizeRoom} from './framework/web/desktop-client.mjs';

test('room links use the path id while numeric query parameters and fragments do not alter it',()=>{
  assert.equal(normalizeRoom('123456789'),'123456789');
  assert.equal(normalizeRoom(' https://live.douyin.com/123456789?from=99#t=22 '),'123456789');
  for(const value of ['https://v.douyin.com/abc/','https://example.com/123456789','123',''])assert.throws(()=>normalizeRoom(value));
});

test('desktop operations send only normalized rooms and project-scoped output URLs',async t=>{
  const previous=globalThis.window,calls=[];
  globalThis.window={pywebview:{api:{
    open_live_room:room=>{calls.push(['room',room]);return 'opened'},
    start_capture:room=>{calls.push(['capture',room]);return 'started'},
    open_scene_window:(url,orient)=>{calls.push(['output',url,orient]);return 'output'},
  }}};
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous});
  const host=new DesktopClient('starter');
  await host.openLiveRoom('https://live.douyin.com/123456?test=77');
  await host.startCapture('123456');await host.openOutput('portrait');
  assert.deepEqual(calls,[['room','123456'],['capture','123456'],['output','/framework/web/live-view.html?project=starter','portrait']]);
});

test('browser capture fallback uses the same normalized id as the native host',async t=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;let requested;
  delete globalThis.window;
  globalThis.fetch=async url=>{requested=url;return {ok:true,json:async()=>({ok:true})}};
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;globalThis.fetch=previousFetch});
  await new DesktopClient('starter').startCapture('https://live.douyin.com/123456?from=9988');
  assert.equal(new URL(requested,'http://127.0.0.1').searchParams.get('room'),'123456');
});

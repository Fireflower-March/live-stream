const container=document.getElementById('projects');
const status=document.getElementById('status');
const refresh=document.getElementById('refresh');
const notice=document.getElementById('notice');
const errors=document.getElementById('project-errors');
const languageNames={zh:'中文',en:'English'};
let navigating=false;

function localEntry(value,projectId){
  if(typeof value!=='string')throw new Error('项目入口无效');
  const url=new URL(value,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith('/projects/'+encodeURIComponent(projectId)+'/')||!url.pathname.endsWith('.html'))throw new Error('项目入口无效');
  return url.href;
}

async function enterProject(project,entry){
  if(navigating)return;
  navigating=true;
  refresh.disabled=true;
  container.querySelectorAll('button').forEach(button=>button.disabled=true);
  status.classList.remove('error');
  status.textContent='正在进入 '+project.name+'…';
  try{
    const destination=localEntry(entry,project.id);
    // Native switching closes the previous output window before changing pages.
    // Language entry selection happens after that cleanup, in the same window.
    if(window.pywebview?.api?.open_project){
      const opened=await window.pywebview.api.open_project(project.id);
      localEntry(opened,project.id);
      location.assign(entry===project.entry?opened:destination);
    }else location.assign(destination);
  }catch(error){
    navigating=false;
    refresh.disabled=false;
    container.querySelectorAll('button').forEach(button=>button.disabled=false);
    status.classList.add('error');
    status.textContent='无法进入项目：'+error.message;
  }
}

function action(project,entry,label,secondary=false){
  const button=document.createElement('button');
  button.type='button';button.className='enter-button'+(secondary?' secondary':'');
  button.textContent=label;
  button.addEventListener('click',()=>enterProject(project,entry));
  return button;
}

function card(project){
  localEntry(project.entry,project.id);
  const article=document.createElement('article');article.className='project-card';
  const top=document.createElement('div');top.className='card-top';
  const symbol=document.createElement('span');symbol.className='project-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent=project.output?.camera?'▧':'◇';
  const pages=document.createElement('span');pages.className='page-list';
  const entries=Object.entries(project.entries||{});
  pages.textContent=entries.length?entries.map(([name])=>languageNames[name]||name).join(' / '):'独立项目';
  top.append(symbol,pages);
  const title=document.createElement('h2');title.textContent=project.name;
  const description=document.createElement('p');description.className='description';description.textContent=project.description||'打开项目控制台，预览画面并连接直播互动。';
  const actions=document.createElement('div');actions.className='card-actions';
  const defaultPage=entries.find(([,entry])=>entry===project.entry)?.[0];
  actions.append(action(project,project.entry,defaultPage&&languageNames[defaultPage]?'进入'+languageNames[defaultPage]+'页面':'进入项目'));
  for(const [name,entry] of entries){
    if(entry===project.entry)continue;
    localEntry(entry,project.id);
    actions.append(action(project,entry,(languageNames[name]||name)+' 页面',true));
  }
  article.append(top,title,description,actions);return article;
}

async function loadProjects(){
  refresh.disabled=true;container.setAttribute('aria-busy','true');
  status.classList.remove('error');status.textContent='正在读取项目…';
  notice.hidden=true;errors.replaceChildren();container.replaceChildren();
  try{
    const response=await fetch('/__projects',{cache:'no-store'});
    if(!response.ok)throw new Error('项目列表读取失败（'+response.status+'）');
    const data=await response.json();
    if(!Array.isArray(data.projects))throw new Error('项目列表格式无效');
    let count=0;
    for(const project of data.projects){
      try{container.append(card(project));count++;}
      catch(error){const li=document.createElement('li');li.textContent=(project.name||project.id||'未命名项目')+'：'+error.message;errors.append(li);}
    }
    for(const item of Array.isArray(data.errors)?data.errors:[]){const li=document.createElement('li');li.textContent=String(item.project||'未命名项目')+'：'+String(item.error||'配置无效');errors.append(li);}
    notice.hidden=!errors.children.length;
    status.textContent='已发现 '+count+' 个可用项目';
    if(!count){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='暂时没有可用项目。请检查项目目录和项目配置后刷新列表。';container.append(empty);}
  }catch(error){
    status.classList.add('error');status.textContent=error.message;
    const empty=document.createElement('p');empty.className='empty-state';empty.textContent='请通过 start.bat 启动本地服务，再刷新项目列表。';container.append(empty);
  }finally{refresh.disabled=false;container.setAttribute('aria-busy','false');}
}
refresh.addEventListener('click',loadProjects);
loadProjects();

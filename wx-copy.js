// 微信号一键复制：点击 .wx 按钮即可将 data-wx 精确复制到剪贴板（只复制微信号本身）。
(function(){
  function fin(b){var o=b.textContent;b.textContent='已复制 ✓';setTimeout(function(){b.textContent=o},1300)}
  function fallback(t,b){var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');fin(b)}catch(e){}document.body.removeChild(ta)}
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('.wx'):null;if(!b)return;
    var t=b.getAttribute('data-wx')||b.textContent.trim();
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){fin(b)},function(){fallback(t,b)})}
    else fallback(t,b);
  });
})();

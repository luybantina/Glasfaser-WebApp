// The program page starts as the old basic page and the updates rebuild it a moment later: until then a loading screen with a progress bar covers it.
(function(){
  var d=document.documentElement,done=false,pct=3,target=12,box=document.createElement('div');
  box.id='gfSplash';
  box.setAttribute('style','position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#f5f7fa;color:#17324d;font:600 18px system-ui,sans-serif;transition:opacity .25s');
  box.innerHTML='<div>Glasfaser WebApp</div><div style="width:min(320px,70vw);height:8px;background:#dde3ea;border-radius:99px;overflow:hidden"><div id="gfSplashBar" style="height:100%;width:3%;background:#3d7a58;border-radius:99px;transition:width .25s"></div></div><div id="gfSplashTxt" style="font:500 13px system-ui,sans-serif;color:#667085">Загрузка… 3%</div>';
  d.appendChild(box);
  var bar=box.querySelector('#gfSplashBar'),txt=box.querySelector('#gfSplashTxt');
  function paint(){bar.style.width=pct+'%';txt.textContent='Загрузка… '+Math.round(pct)+'%'}
  // real stages set the target, in between the bar creeps slowly towards it
  function stage(n){if(n>target)target=n}
  var iv=setInterval(function(){if(pct<target)pct+=Math.max(0.4,(target-pct)*0.12);if(pct>target)pct=target;paint()},120);
  stage(25);
  document.addEventListener('DOMContentLoaded',function(){stage(55)});
  window.addEventListener('load',function(){stage(80)});
  function ok(){
    if(done)return;done=true;clearInterval(iv);clearTimeout(t);if(mo)mo.disconnect();
    pct=100;paint();d.classList.add('gf-ready');
    setTimeout(function(){box.style.opacity='0';setTimeout(function(){box.remove()},300)},120);
  }
  var t=setTimeout(ok,15000),mo;
  function check(){
    var n=document.getElementById('nav'),a=document.getElementById('app');
    if(n&&a)stage(70);
    if(n&&n.hasAttribute('data-gf362')&&a&&a.children.length){stage(95);setTimeout(ok,250);return true}
  }
  mo=new MutationObserver(check);
  mo.observe(d,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gf362']});
})();

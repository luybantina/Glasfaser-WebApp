// The program page starts as the old basic page and the updates rebuild it a moment later: until then a plain loading screen covers it.
(function(){
  var d=document.documentElement,st=document.createElement('style');
  st.textContent='html:not(.gf-ready)::before{content:"Glasfaser WebApp \2026";position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:#f5f7fa;color:#17324d;font:600 18px system-ui,sans-serif}';
  document.head.appendChild(st);
  var done=false,t=setTimeout(ok,12000),mo;
  function ok(){if(done)return;done=true;clearTimeout(t);if(mo)mo.disconnect();d.classList.add('gf-ready')}
  function check(){
    var n=document.getElementById('nav'),a=document.getElementById('app');
    if(n&&n.hasAttribute('data-gf362')&&a&&a.children.length){setTimeout(ok,250);return true}
  }
  mo=new MutationObserver(check);
  mo.observe(d,{childList:true,subtree:true,attributes:true,attributeFilter:['data-gf362']});
})();

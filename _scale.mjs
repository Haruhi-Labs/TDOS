import { chromium } from 'playwright';
const b=await chromium.launch();
// 模拟 Windows 缩放后的有效视口(CSS px 变小、DPR 升高)
const sizes=[
  {w:1280,h:720,dpr:1.5,tag:'1080p@150'},
  {w:1366,h:768,dpr:1.25,tag:'1366x768'},
  {w:1536,h:864,dpr:1.25,tag:'1080p@125'},
];
async function shot(page,name,tag){
  // 报告是否有横向/纵向溢出
  const ov=await page.evaluate(()=>({
    bw:document.documentElement.scrollWidth, vw:window.innerWidth,
    bh:document.documentElement.scrollHeight, vh:window.innerHeight,
  }));
  console.log(`  ${name} @${tag}: 内容 ${ov.bw}x${ov.bh} / 视口 ${ov.vw}x${ov.vh}` + (ov.bw>ov.vw+1?' ⚠横向溢出':'') + (ov.bh>ov.vh+1?' ⚠纵向溢出':''));
  await page.screenshot({path:`/tmp/sc-${name}-${tag}.png`});
}
for(const s of sizes){
  const ctx=await b.newContext({viewport:{width:s.w,height:s.h},deviceScaleFactor:s.dpr});
  const p=await ctx.newPage();
  await p.goto('http://localhost:5179/',{waitUntil:'networkidle'}); await p.waitForTimeout(700); await shot(p,'menu',s.tag);
  await p.goto('http://localhost:5179/play',{waitUntil:'networkidle'}); await p.waitForTimeout(900); await shot(p,'charsel',s.tag);
  await p.goto('http://localhost:5179/online',{waitUntil:'networkidle'}); await p.waitForTimeout(700); await shot(p,'online',s.tag);
  await ctx.close();
}
await b.close(); console.log('done');

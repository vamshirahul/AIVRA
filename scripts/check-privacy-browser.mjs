// Opt-in U90.03 helper for the existing installed-Chromium/CDP harness only.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function checkPrivacyBrowser({page,evaluate,waitFor,load,key,base,output,evidence,socket}) {
  assert.equal(new URL(base).hostname,"127.0.0.1");
  const requests=[];
  socket.addEventListener("message",({data})=>{const m=JSON.parse(data);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url))requests.push({url:m.params.request.url,method:m.params.request.method});});
  await page('Network.enable');
  const routes=['/','/data-mapper','/application-rationalization','/license-optimizer','/cost-synergy','/scenario-modeling','/playbook-generator','/tsa-tracker','/ai-assistant','/integration-health'];
  const saved=()=>evaluate('sessionStorage.getItem("aivra:r0:demo-session:v1")');
  let initial;
  for(const width of [1440,390,320]) {
    await page('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    for(const route of routes) {
      await load('Page.navigate',{url:base+route});initial??=await saved();assert.equal(await saved(),initial);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${width} ${route}`);
      assert.equal(await evaluate("document.querySelectorAll('.future-feature').length"),7);
      assert.equal(await evaluate("document.querySelectorAll('.future-features a,.future-features button,.future-features input,.future-features [tabindex],.future-features [role=button],.future-features [role=link]').length"),0);
      // A real Tab traversal, not programmatically focusing every target.
      const expected=await evaluate(`(()=>{window.__focusTargets=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');document.querySelector('.skip-link').focus();return window.__focusTargets.length;})()`);
      const reached=new Set();for(let i=0;i<expected+5;i++){const index=await evaluate('window.__focusTargets.indexOf(document.activeElement)');if(index>=0)reached.add(index);await key('Tab',9);}
      assert.equal(reached.size,expected,`Tab reachability ${width} ${route}`);
      if(width<1000){await evaluate("document.querySelector('.menu-toggle').focus()");await key('Enter',13);assert.equal(await evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"),'true');await key('Tab',9);assert.equal(await evaluate("document.activeElement.matches('nav a')"),true);await key('Escape',27);assert.equal(await evaluate("document.activeElement.matches('.menu-toggle')"),true);}
      await evaluate("document.querySelector('.skip-link').focus()");await key('Enter',13);assert.equal(await evaluate("document.activeElement.id"),'main-content');
    }
    await load('Page.navigate',{url:base+'/integration-health'});const shot=await page('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`${output}/public-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  evidence.checks.push('Keyboard Tab reaches all enabled visible controls across ten public routes at 1440/390/320; skip link, mobile menu Enter/Escape/focus, no overflow, seven inert placeholders and unchanged session.');
  await load('Page.navigate',{url:base+'/data-mapper'});
  for(const side of ['Buyer','Target']) {
    if(side==='Target'){await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");await key('ArrowRight',39);}
    const info=await evaluate(`(()=>{const e=document.querySelector('.csv-preview section:not([hidden]) input[type=file]');return {label:[...e.labels].map(l=>l.textContent).join(' '),description:e.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id)?.textContent).join(' ')};})()`);
    assert.equal(info.label,`Choose ${side} CSV`);assert.match(info.description,/synthetic\/test data only/);assert.match(info.description,/Do not select confidential transaction information/);assert.match(info.description,/not uploaded to AIVRA servers/);
  }
  await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");await key('ArrowLeft',37);
  const before=await saved(),filename=path.resolve(output,'synthetic-privacy.csv');await writeFile(filename,'Name,Notes\nOffline sample,"<img src=x onerror=window.__privacyExecuted=1>"');
  const {root}=await page('DOM.getDocument'),{nodeId}=await page('DOM.querySelector',{nodeId:root.nodeId,selector:'.csv-preview section:not([hidden]) input[type=file]'});await page('DOM.setFileInputFiles',{nodeId,files:[filename]});
  await waitFor("!!document.querySelector('.csv-metadata')");assert.equal(await saved(),before);assert.equal(await evaluate('window.__privacyExecuted??null'),null);assert.equal(await evaluate("document.querySelectorAll('.csv-table img').length"),0);
  await evaluate("document.querySelector('.csv-clear').focus()");await key('Enter',13);await waitFor("!document.querySelector('.csv-metadata')");assert.equal(await saved(),before);
  evidence.checks.push('Buyer/Target file controls describe synthetic-only/confidential-data and local parsing warnings; real file selection renders malicious-looking text safely, remains draft-only and clears by keyboard without session changes.');
  await load('Page.navigate',{url:base+'/ai-assistant'});assert.ok(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Ask Assistant'&&b.disabled)"));
  assert.equal(await saved(),initial);assert.ok(requests.every(r=>new URL(r.url).origin===base&&r.method==='GET'&&!new URL(r.url).pathname.startsWith('/api/')));
  evidence.checks.push('Observed requests are same-origin GET only: no upload/API/provider/external requests; public Assistant remains disabled, no fabricated results or source mutations.');
  evidence.limitations='Actual public-browser subset only. Keyboard/DOM checks are not full WCAG, screen-reader, contrast or penetration certification. Protected result delivery/live AI remain unavailable; no fabricated successful results installed.';
  await writeFile(`${output}/network-review.json`,JSON.stringify({requests,external_or_write_requests:0},null,2));
}

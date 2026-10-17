#!/usr/bin/env python3
"""Requires: pip install playwright. Pass --chromium /path/to/chrome.
Compare two source folders with the same --counts, browser and host conditions.
No external requests are made by this offline rendering benchmark.
"""
from pathlib import Path
import json, subprocess, statistics, time, sys, re, base64
from playwright.sync_api import sync_playwright
import argparse, os
parser=argparse.ArgumentParser(description='Offline synthetic Chromium rendering benchmark (not a live YouTube/OBS test).')
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--label', default='benchmark')
parser.add_argument('--output', type=Path, default=Path('performance-results'))
parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
parser.add_argument('--counts',type=int,nargs='+',default=[350,1000,2000])
args=parser.parse_args();root=args.root.resolve();label=args.label;counts=args.counts;results=[];args.output.mkdir(parents=True,exist_ok=True)
result_file=args.output/(label+'.json')
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for count in counts:
    snapshot=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('profile-snapshot.mjs')),str(root),str(count),'--bundle'],text=True))
    ctx=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce');page=ctx.new_page();errors=[];page.on('pageerror',lambda e:(errors.append(str(e)),print('PAGE ERROR',str(e),flush=True)))
    cdp=ctx.new_cdp_session(page);cdp.send('Emulation.setCPUThrottlingRate',{'rate':4});cdp.send('Performance.enable')
    html=(root/'public/control.html').read_text();html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]*>','',html)
    # CSS/assets are injected unchanged; only thumbnail network traffic is stubbed.
    html=html.replace('</head>','<style>'+(root/'public/assets/style.css').read_text()+'</style></head>')
    html=html.replace('/assets/logo.png','data:image/png;base64,'+base64.b64encode((root/'public/assets/logo.png').read_bytes()).decode())
    page.set_content(html)
    page.evaluate('''s=>{window.fixture=s;window.fetch=async(url,opts)=>{const path=String(url);let value=path.includes("session")?{authenticated:true}:path.includes("operator")?(path.includes("compact=1")?(path.includes("&catalog=")?fixture.delta:fixture.first):fixture.full):{ok:true};return {ok:true,json:async()=>JSON.parse(JSON.stringify(value))};};}''',snapshot)
    common=(root/'public/assets/common.js').read_text().replace('export ','');control=(root/'public/assets/control.js').read_text();control=re.sub(r'^import[^\n]+\n','',control,flags=re.M)
    # This test does not generate or download a thumbnail for every video.
    common=re.sub(r'export ', '', common)
    common=re.sub(r'function thumbnail\(videoId\)\{[^\n]*', 'function thumbnail(videoId){return "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22180%22/%3E";}',common)
    extra=''
    # New page helpers are normal ES modules; concatenate for offline testing.
    for f in ['queue-page.js','single-flight.js']:
      if (root/'public/assets'/f).exists():extra+=(root/'public/assets'/f).read_text().replace('export ','')+'\n'
    t=time.perf_counter();page.add_script_tag(content='(async()=>{'+common+'\n'+extra+'\n'+control+'\nwindow.__bench={drawQueue,refresh,getState:()=>state};})();')
    page.wait_for_function('window.__bench && document.querySelectorAll("#queue .queue-item").length>0',timeout=20000)
    page.wait_for_timeout(300);initial_ms=(time.perf_counter()-t)*1000
    rows=page.locator('#queue .queue-item').count();dom=page.evaluate('document.querySelectorAll("*").length')
    samples=page.evaluate('''async()=>{const times=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);const t=performance.now();__bench.drawQueue(__bench.getState());const js=performance.now()-t;document.querySelector('#queue').getBoundingClientRect();times.push({js,layout:performance.now()-t});await new Promise(requestAnimationFrame);}return times;}''')
    refreshes=page.evaluate('''async()=>{const ts=[];for(let i=0;i<5;i++){const t=performance.now();await __bench.refresh();document.body.getBoundingClientRect();ts.push(performance.now()-t);}return ts;}''')
    target=page.locator('#queue .queue-move-select').first;target.select_option('nextRotation');handle=target.element_handle();page.wait_for_timeout(3000);preserved=handle.evaluate('(el)=>el.isConnected && el.value==="nextRotation"')
    metrics={v['name']:v['value'] for v in cdp.send('Performance.getMetrics')['metrics']}
    res={'version':label,'videos':count,'offline_initial_ui_ms':round(initial_ms,1),'mounted_queue_rows':rows,'dom_elements':dom,'full_operator_bytes':len(json.dumps(snapshot['full'],separators=(',',':'),ensure_ascii=False).encode()),'steady_poll_bytes':len(json.dumps(snapshot['delta'],separators=(',',':'),ensure_ascii=False).encode()),'queue_js_median_ms':round(statistics.median(s['js'] for s in samples),2),'queue_js_max_ms':round(max(s['js'] for s in samples),2),'queue_js_layout_median_ms':round(statistics.median(s['layout'] for s in samples),2),'refresh_median_ms':round(statistics.median(refreshes),2),'heap_used_bytes':int(metrics.get('JSHeapUsedSize',0)),'dropdown_selection_preserved':preserved,'errors':errors,'samples':samples,'refresh_samples':refreshes}
    print(json.dumps(res),flush=True);results.append(res);ctx.close()
  browser.close()
result_file.write_text(json.dumps(results,indent=2))

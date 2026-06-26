import { CSS as REVIEW_CSS, CALIBRATION_CSS } from '../../../packages/review-ui/src/html.ts';
import type { AppConfig } from './config.ts';

const APP_CSS = `
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,'PingFang SC',sans-serif;background:var(--bg);color:var(--text)}
.app{display:flex;height:100vh;overflow:hidden}
.side{width:340px;min-width:300px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:#fbfcfe}
.side-h{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:baseline;gap:8px}
.side-h h1{font-size:16px;margin:0}
.mode{font-size:10px;color:#5b6472;background:#eef1f5;padding:2px 7px;border-radius:8px}
.mode.demo{background:#fef3c7;color:#92400e}
.filters{padding:12px 16px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:8px}
.filters input{width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font:inherit}
.frow{display:flex;gap:8px;align-items:center}
.list{flex:1;overflow:auto;padding:8px}
.row{padding:9px 11px;border:1px solid transparent;border-radius:9px;cursor:pointer}
.row:hover{background:#eef4ff}
.row.sel{background:#e8f0fe;border-color:#cfe0ff}
.rid{font-size:12px;font-weight:600;font-family:var(--mono)}
.rmeta{font-size:11px;color:#5b6472;margin-top:2px}
.rtag{display:inline-block;font-size:10px;background:#eef1f5;color:#5b6472;padding:0 6px;border-radius:6px;margin-left:3px}
/* Right-hand main area: conversation (scrolls) + judgment (fixed sidebar, so you can score from anywhere in the scroll) */
.main{flex:1;display:flex;overflow:hidden;min-width:0}
.convo{flex:1;overflow:auto;padding:20px 26px;min-width:0}
.judgment{width:344px;min-width:300px;overflow:auto;border-left:1px solid var(--border);background:#fbfcfe;padding:16px 18px}
.judgment .sec-h:first-child{margin-top:0}
.detail-empty{flex:1;color:#94a3b8;text-align:center;padding:90px 20px}
@media(max-width:1080px){.judgment{width:300px;min-width:260px}}
.sec-h{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#5b6472;margin:18px 0 8px;font-weight:600}
.existing-scores{display:flex;flex-wrap:wrap;gap:6px}
.es{font-size:11px;border:1px solid var(--border);border-radius:7px;padding:2px 8px;background:#fff}
.es i{color:#94a3b8;font-style:normal}
.muted{color:#94a3b8;font-size:12px}
.tl-opt.on{background:#dbeafe;border-color:#2563eb;color:#1e40af}
#submsg{margin-left:10px;font-size:12px}
.hint{font-size:10.5px;color:#92400e;background:#fef9ec;border:1px solid #fde9b8;border-radius:6px;padding:5px 8px;display:none}
.pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:10px;border-top:1px solid var(--border);font-size:12px;color:#475569}
.pager button{border:1px solid #e2e8f0;background:#fff;border-radius:6px;padding:3px 10px;cursor:pointer}
.pager button:disabled{opacity:.4;cursor:not-allowed}
.note{background:#fef9ec;border:1px solid #fde9b8;color:#92400e;border-radius:8px;padding:9px 12px;font-size:12.5px;margin-bottom:12px}
.note code{background:#fff;padding:1px 5px;border-radius:4px}
.nav{display:flex;gap:4px;padding:8px 16px 0}
.nav button{border:none;background:none;font:inherit;font-size:13px;color:#5b6472;padding:6px 10px;border-radius:8px 8px 0 0;cursor:pointer}
.nav button.on{color:var(--accent);font-weight:600;background:#fff;border:1px solid var(--border);border-bottom:none}
.cal-wrap{flex:1;overflow:auto;padding:20px 26px}
.cal-back{font-size:12px;color:var(--accent);cursor:pointer;margin-bottom:10px;display:inline-block}
`;

/** The review app's HTML shell: filters + list on the left, detail + scoring on the right. See /client.js for the frontend logic. */
export function renderShell(_cfg: AppConfig): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tracelens · review</title><style>${REVIEW_CSS}${CALIBRATION_CSS}${APP_CSS}</style></head>
<body><div class="app">
<div class="side">
  <div class="side-h"><h1>tracelens</h1><span class="mode" id="mode"></span></div>
  <div class="nav"><button id="nav-review" class="on">Review</button><button id="nav-cal">Calibration</button></div>
  <div class="filters">
    <input id="f-tags" placeholder="tags (comma-separated)">
    <input id="f-user" placeholder="userId">
    <input id="f-search" placeholder="search…">
    <div id="search-hint" class="hint"></div>
    <div class="frow"><button id="refresh" class="tl-submit" style="padding:5px 12px">Filter</button><span id="count" class="muted"></span></div>
  </div>
  <div class="list" id="list"></div>
  <div class="pager" id="pager"></div>
</div>
<div class="main" id="main"><div class="detail-empty">← pick a trace to review</div></div>
<div class="cal-wrap" id="cal" style="display:none"></div>
</div><script src="/client.js"></script></body></html>`;
}

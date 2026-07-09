# Chrome Extension Bridge

This extension lets the local recruitment assistant reuse an already logged-in Chrome tab instead of launching a separate Playwright profile.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `extension/` directory.
5. Start the local app with `npm run dev`.
6. In the local app, edit the job/filter fields and click `保存条件` so the extension reads the latest saved filters.
7. Open BOSS in the normal Chrome profile where you are already logged in.
8. Go to the recruiter-side candidate, talent, resume list page, or `https://www.zhipin.com/web/chat/search` or `https://www.zhipin.com/web/chat/recommend`.
9. Click the extension icon and choose `诊断筛选控件` when BOSS selectors need calibration. The extension will read visible filter inputs/buttons from every accessible BOSS frame and save the latest report to the local app.
10. Click the extension icon and choose `筛选并采集` to fill filters from the local default job, verify the list refreshed, and import candidates. Use `仅采集当前页` only when the BOSS list is already filtered.

The extension reads the local default job from `http://localhost:3000/api/jobs`, fills visible BOSS filter controls inside the current page or same-origin frames, stops if no submit button/list refresh is detected, then posts candidates to `http://localhost:3000/api/extension/candidates`. The `诊断筛选控件` action posts a bounded selector report to `http://localhost:3000/api/extension/filter-diagnostics` and does not click, fill, submit, or collect candidates. It does not log in, bypass captcha, bypass risk controls, or click send.




import { Router } from "express";
import type { SiteAdapter } from "../domain";
import { updateRuntime } from "../runtime";
import { asyncHandler } from "./utils";

export function createBrowserRouter({ adapter }: { adapter: SiteAdapter }) {
  const router = Router();

  router.post("/open", asyncHandler(async (_req, res) => {
    const loggedIn = await adapter.ensureLoggedIn();
    updateRuntime({
      browserStatus: loggedIn ? "connected" : "login_required",
      pauseReason: loggedIn ? null : "需要在打开的浏览器里手动登录。"
    }, "browser");
    res.json({ ok: true, loggedIn });
  }));

  return router;
}

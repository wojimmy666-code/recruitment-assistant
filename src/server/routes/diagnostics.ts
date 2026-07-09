import { Router } from "express";
import { getControlledPage } from "../automation/browser-controller";
import { inspectCurrentPageSelectors } from "../automation/selector-calibrator";
import { asyncHandler } from "./utils";

export function createDiagnosticsRouter() {
  const router = Router();

  router.post("/selectors", asyncHandler(async (_req, res) => {
    const page = await getControlledPage();
    const diagnostics = await inspectCurrentPageSelectors(page);
    res.json(diagnostics);
  }));

  return router;
}
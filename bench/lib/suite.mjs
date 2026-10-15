// Runs the vendored families (and the holdout) against a kit and returns the report.
// `quick` is the small, fast subset that the test suite runs; the whole set runs under `npm run bench`.

import { createReport, summarize } from './report.mjs';
import * as vendored from './vendored.mjs';
import { runHoldout } from '../holdout/run.mjs';

export { summarize };

export function runSuite(kit, { quick = false } = {}) {
  const report = createReport();
  vendored.runI18n(report, kit, 'i18n-excalidraw.json.gz', 'compareMirror/i18n-excalidraw');
  vendored.runI18n(report, kit, 'i18n-jitsi.json.gz', 'compareMirror/i18n-jitsi');
  vendored.runEntities(report, kit, { real: !quick });
  vendored.runAdvisories(report, kit);
  vendored.runTolerance(report, kit);
  vendored.runConstants(report, kit);
  vendored.runStampsEdge(report, kit);
  vendored.runStampsInjected(report, kit);
  if (!quick) {
    vendored.runStampsHistory(report, kit);
    vendored.runStampsOptions(report, kit);
  }
  runHoldout(report, kit, quick ? { families: ['http-status', 'spdx'] } : {});
  return report;
}

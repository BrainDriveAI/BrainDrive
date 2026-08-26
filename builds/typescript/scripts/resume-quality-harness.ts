import { qualityReportMarkdown, runResumeQualityFoundation } from "../resume-inference/quality.js";

const report = await runResumeQualityFoundation();
process.stdout.write(process.argv.includes("--markdown") ? qualityReportMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
if (report.outcome !== "passed") process.exitCode = 1;

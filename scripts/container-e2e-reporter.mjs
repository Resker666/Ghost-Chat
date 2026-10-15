import { writeFileSync } from "node:fs";
import path from "node:path";

const conversationTitle =
  "two isolated contexts exchange encrypted Unicode text and destroy irreversibly";
const restartTitle =
  "isolated production container restart clears both peers and invalidates its invitation";

export function assertCoverageSummary(summary) {
  const keys = [
    "passed",
    "skipped",
    "failed",
    "conversationPassed",
    "containerRestartPassed",
  ];
  if (
    !summary ||
    typeof summary !== "object" ||
    Object.keys(summary).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(summary, key)) ||
    ![summary.passed, summary.skipped, summary.failed].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    typeof summary.conversationPassed !== "boolean" ||
    typeof summary.containerRestartPassed !== "boolean"
  ) {
    throw new Error(
      "Safe container browser summary is invalid; acceptance was not established",
    );
  }
  if (summary.failed !== 0)
    throw new Error(
      "Container browser acceptance failed; selected tests or runner errors did not pass",
    );
  if (
    summary.passed === 0 ||
    !summary.conversationPassed ||
    !summary.containerRestartPassed
  ) {
    throw new Error(
      "Container browser coverage is incomplete: encrypted conversation and isolated container restart must both pass; skipped or filtered-out cases do not satisfy acceptance",
    );
  }
}

export default class SafeContainerReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || process.env.E2E_SAFE_SUMMARY_FILE;
    if (!this.outputFile || !path.isAbsolute(this.outputFile))
      throw new Error(
        "An absolute isolated container summary path is required",
      );
    this.results = new Map();
    this.errors = 0;
  }

  onTestEnd(test, result) {
    const file = path.basename(test.location.file);
    this.results.set(test.id, {
      status:
        result.status === "passed"
          ? "passed"
          : result.status === "skipped"
            ? "skipped"
            : "failed",
      conversation: file === "chat.spec.ts" && test.title === conversationTitle,
      restart: file === "container.spec.ts" && test.title === restartTitle,
    });
  }

  onError() {
    this.errors++;
  }

  onEnd(result) {
    const summary = {
      passed: 0,
      skipped: 0,
      failed: this.errors,
      conversationPassed: false,
      containerRestartPassed: false,
    };
    for (const test of this.results.values()) {
      summary[test.status]++;
      if (test.status === "passed") {
        summary.conversationPassed ||= test.conversation;
        summary.containerRestartPassed ||= test.restart;
      }
    }
    if (result.status !== "passed" && summary.failed === 0) summary.failed++;
    // Persist only these counters and coverage flags; test metadata and errors stay out.
    writeFileSync(this.outputFile, JSON.stringify(summary) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
}

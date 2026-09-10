const form = document.getElementById("convert-form");
const fileInput = document.getElementById("file-input");
const btn = document.getElementById("convert-btn");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");
const output = document.getElementById("output");
const download = document.getElementById("download");
const convertWarnings = document.getElementById("convert-warnings");
const convertWarningList = document.getElementById("convert-warning-list");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;

  btn.disabled = true;
  result.hidden = true;
  statusEl.hidden = false;
  statusEl.className = "status";
  statusEl.textContent = "Converting\u2026";

  const body = new FormData();
  body.append("file", file);

  try {
    const res = await fetch("/convert?report=1", { method: "POST", body });
    const text = await res.text();
    if (!res.ok) {
      statusEl.className = "status error";
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        // Non-JSON error body: show the raw text.
      }
      statusEl.textContent = `Error ${res.status}: ${message}`;
      return;
    }
    const report = JSON.parse(text);
    const json = JSON.stringify(report.crate, null, 2);
    statusEl.hidden = true;
    output.textContent = json;
    download.href = URL.createObjectURL(
      new Blob([json], { type: "application/ld+json" }),
    );

    convertWarningList.textContent = "";
    const warnings = report.warnings ?? [];
    if (warnings.length) {
      for (const warning of warnings) {
        const li = document.createElement("li");
        li.className = `result-item ${warning.level}`;
        const status = document.createElement("span");
        status.className = "result-status";
        status.textContent = warning.level;
        li.append(status, document.createTextNode(warning.message));
        convertWarningList.append(li);
      }
    }
    convertWarnings.hidden = warnings.length === 0;

    result.hidden = false;
  } catch (err) {
    statusEl.className = "status error";
    statusEl.textContent = `Request failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
});

const validateForm = document.getElementById("validate-form");
const validateInput = document.getElementById("validate-input");
const validateFile = document.getElementById("validate-file");
const validateBtn = document.getElementById("validate-btn");
const validateStatus = document.getElementById("validate-status");
const validateResults = document.getElementById("validate-results");
const validateBanner = document.getElementById("validate-banner");
const validateList = document.getElementById("validate-list");

validateFile.addEventListener("change", async () => {
  const file = validateFile.files[0];
  if (file) validateInput.value = await file.text();
});

validateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = validateInput.value.trim();
  if (!text) return;

  try {
    JSON.parse(text);
  } catch (err) {
    validateResults.hidden = true;
    validateStatus.hidden = false;
    validateStatus.className = "status error";
    validateStatus.textContent = `Not valid JSON: ${err.message}`;
    return;
  }

  validateBtn.disabled = true;
  validateResults.hidden = true;
  validateStatus.hidden = false;
  validateStatus.className = "status";
  validateStatus.textContent = "Validating\u2026";

  try {
    const res = await fetch("/validate", {
      method: "POST",
      headers: { "Content-Type": "application/ld+json" },
      body: text,
    });
    const report = await res.json();
    if (!res.ok) {
      validateStatus.className = "status error";
      validateStatus.textContent = `Error ${res.status}: ${report.error ?? "validation failed"}`;
      return;
    }

    validateStatus.hidden = true;
    validateBanner.className = `banner ${report.valid ? "valid" : "invalid"}`;
    validateBanner.textContent = report.valid
      ? "Valid RO-Crate"
      : "Not a valid RO-Crate";

    validateList.textContent = "";
    for (const item of report.results) {
      const li = document.createElement("li");
      li.className = `result-item ${item.status}`;
      const status = document.createElement("span");
      status.className = "result-status";
      status.textContent = item.status;
      li.append(status, document.createTextNode(item.message));
      validateList.append(li);
    }
    validateResults.hidden = false;
  } catch (err) {
    validateStatus.className = "status error";
    validateStatus.textContent = `Request failed: ${err.message}`;
  } finally {
    validateBtn.disabled = false;
  }
});

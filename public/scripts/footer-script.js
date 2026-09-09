const form = document.getElementById("convert-form");
const fileInput = document.getElementById("file-input");
const btn = document.getElementById("convert-btn");
const statusEl = document.getElementById("status");
const result = document.getElementById("result");
const output = document.getElementById("output");
const download = document.getElementById("download");

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
    const res = await fetch("/convert", { method: "POST", body });
    const text = await res.text();
    if (!res.ok) {
      statusEl.className = "status error";
      statusEl.textContent = `Error ${res.status}: ${text}`;
      return;
    }
    const json = JSON.stringify(JSON.parse(text), null, 2);
    statusEl.hidden = true;
    output.textContent = json;
    download.href = URL.createObjectURL(
      new Blob([json], { type: "application/ld+json" }),
    );
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

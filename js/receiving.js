window.NextPulse = window.NextPulse || {};

window.NextPulse.receiving = (() => {
  const RECEIVING_ENDPOINT = "/receiving/receipts";
  let catalogItems = [];
  let lines = [];
  let hasLoaded = false;
  let barcodeStream = null;
  let barcodeFrameRequest = null;
  let barcodeControls = null;
  let scanCatalogItems = [];
  let scannedItem = null;
  let scannerActionMode = false;
  const packageDefaults = {
    "RM-UN-25KG": { packageUnit: "TORBA", unitsPerPack: 25, baseUnit: "KG" },
    "RM-AYCICEK-20LT": { packageUnit: "KOLI", unitsPerPack: 20, baseUnit: "LT" },
    "RM-VITA-18LT": { packageUnit: "ADET", unitsPerPack: 18, baseUnit: "LT" },
    "RM-PUDRA-25KG": { packageUnit: "TORBA", unitsPerPack: 25, baseUnit: "KG" },
    "RM-SUSAM-25KG": { packageUnit: "TORBA", unitsPerPack: 25, baseUnit: "KG" },
    "RM-BAHARAT-1KG": { packageUnit: "ADET", unitsPerPack: 1, baseUnit: "KG" },
    "RM-HURMA-10KG": { packageUnit: "KOLI", unitsPerPack: 10, baseUnit: "KG" },
    "RM-VANILIN-25KG": { packageUnit: "TORBA", unitsPerPack: 25, baseUnit: "KG" },
    "RM-KABARTMA-25KG": { packageUnit: "TORBA", unitsPerPack: 25, baseUnit: "KG" },
    "PKG-KOMBE-KABI-ADET": { packageUnit: "KOLI", unitsPerPack: 80, baseUnit: "ADET" },
    "PKG-ETIKET-ADET": { packageUnit: "KOLI", innerUnit: "RULO", innerQtyPerPack: 12, baseQtyPerInner: 500, unitsPerPack: 6000, baseUnit: "ADET" },
    "PKG-KOLI-ADET": { packageUnit: "KOLI", unitsPerPack: 25, baseUnit: "ADET" },
    "PKG-SHRINK-RULO": { packageUnit: "KOLI", innerUnit: "RULO", innerQtyPerPack: 4, baseQtyPerInner: 1, unitsPerPack: 4, baseUnit: "RULO" },
    "PKG-BANT-RULO": { packageUnit: "KOLI", innerUnit: "RULO", innerQtyPerPack: 20, baseQtyPerInner: 1, unitsPerPack: 20, baseUnit: "RULO" },
    "PKG-STREC-RULO": { packageUnit: "KOLI", innerUnit: "RULO", innerQtyPerPack: 2, baseQtyPerInner: 1, unitsPerPack: 2, baseUnit: "RULO" },
    "PKG-AHSAP-PALET": { packageUnit: "ADET", unitsPerPack: 1, baseUnit: "ADET" }
  };
  const reasonLabels = {
    MAL_KABUL: "Mal Kabul",
    SAYIM_FAZLASI: "Sayım Fazlası",
    MANUEL_STOK_GIRISI: "Manuel Stok Girişi"
  };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatQuantity(value) {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showMessage(message, type = "") {
    const element = document.getElementById("receivingMessage");

    if (!element) {
      return;
    }

    element.hidden = !message;
    element.textContent = message || "";
    element.className = `np-alert${type ? ` is-${type}` : ""}`;
  }

  function normalizeCatalogRows(rows) {
    const bySku = new Map();

    rows.forEach((row) => {
      const skuCode = row.skuCode || row.itemCode || row.sku || "";
      const categoryCode = row.categoryCode || row.category || row.itemType || "";
      const defaults = packageDefaults[skuCode] || {};

      if (!skuCode || bySku.has(skuCode) || isFinishedGood(categoryCode)) {
        return;
      }

      bySku.set(skuCode, {
        skuCode,
        categoryCode,
        description: row.description || "",
        barcode: row.barcode || row.ean || row.gtin || "",
        baseUnit: row.baseUnit || row.unit || defaults.baseUnit || "",
        packageUnit: row.packUnit || row.packageUnit || row.containerUnit || row.unit || row.baseUnit || defaults.packageUnit || "",
        innerUnit: row.innerUnit || defaults.innerUnit || "",
        innerQtyPerPack: Number(row.innerQtyPerPack || row.innerUnitsPerPack || defaults.innerQtyPerPack || 0),
        baseQtyPerInner: Number(row.baseQtyPerInner || row.baseQuantityPerInner || defaults.baseQtyPerInner || 0),
        unitsPerPack: Number(row.unitsPerPack || row.unitsPerPackage || row.expectedBaseQuantityPerContainer || row.packSize || defaults.unitsPerPack || 1)
      });
    });

    return Array.from(bySku.values())
      .sort((a, b) => a.skuCode.localeCompare(b.skuCode));
  }

  function normalizeScanRows(rows) {
    const bySku = new Map();
    rows.forEach((row) => {
      const skuCode = row.skuCode || row.itemCode || row.sku || "";
      if (!skuCode || bySku.has(skuCode)) return;
      bySku.set(skuCode, {
        skuCode,
        description: row.description || skuCode,
        categoryCode: row.categoryCode || row.category || "",
        barcode: row.barcode || row.ean || row.gtin || ""
      });
    });
    return Array.from(bySku.values());
  }

  function normalizeBarcode(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");

    if (digits === raw && [8, 12, 13, 14].includes(digits.length)) {
      return digits.padStart(14, "0");
    }

    return raw.toUpperCase();
  }

  async function refreshScanCatalog() {
    const rows = await window.NextPulse.api.get("/receiving/catalog");
    scanCatalogItems = normalizeScanRows(Array.isArray(rows) ? rows : []);
    return rows;
  }

  function isFinishedGood(categoryCode) {
    const normalized = String(categoryCode || "").toUpperCase();
    return ["MAMUL", "FINISHED_GOOD", "FINISHED GOOD", "FG"].includes(normalized);
  }

  async function loadCatalog() {
    const skuInput = document.getElementById("receivingSku");

    if (hasLoaded || !skuInput) {
      return;
    }

    try {
      const rows = await refreshScanCatalog();
      scanCatalogItems = normalizeScanRows(Array.isArray(rows) ? rows : []);
      catalogItems = normalizeCatalogRows(Array.isArray(rows) ? rows : []);
      hasLoaded = true;
      renderSkuResults();
      updateReceivingPreview();
    } catch (exception) {
      const results = document.getElementById("receivingSkuResults");
      if (results) results.innerHTML = `<div class="np-receiving-picker-state">Unable to load materials.</div>`;
      showMessage(exception.message || "Unable to load catalog items for receiving.", "error");
    }
  }

  async function reloadCatalog() {
    hasLoaded = false;
    await loadCatalog();
  }

  function renderSkuResults() {
    const results = document.getElementById("receivingSkuResults");
    const search = document.getElementById("receivingSkuSearch");

    if (!results || !search) {
      return;
    }

    const query = search.value.trim().toLocaleLowerCase("tr-TR");
    if (!query) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    const usedSkus = new Set(lines.map((line) => line.skuCode));
    const availableItems = catalogItems
      .filter((item) => !usedSkus.has(item.skuCode))
      .filter((item) => !query || [item.skuCode, item.description, item.categoryCode, item.barcode]
        .some((value) => String(value || "").toLocaleLowerCase("tr-TR").includes(query)))
      .slice(0, 12);

    if (catalogItems.length === 0) {
      results.innerHTML = `<div class="np-receiving-picker-state">No materials available.</div>`;
      return;
    }

    if (availableItems.length === 0) {
      results.innerHTML = `<div class="np-receiving-picker-state">No matching material. Try another SKU or description.</div>`;
      return;
    }

    results.innerHTML = availableItems.map((item) => `
      <button class="np-receiving-sku-option" type="button" role="option" data-receiving-sku="${escapeHtml(item.skuCode)}">
        <span class="np-item-thumb">${escapeHtml(item.skuCode.slice(0, 2))}</span>
        <span><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.skuCode)} · ${escapeHtml(item.packageUnit)} → ${escapeHtml(item.baseUnit)}</small></span>
        <i class="bi bi-chevron-right"></i>
      </button>
    `).join("");
  }

  function selectSku(skuCode) {
    const normalized = String(skuCode || "").trim();
    const item = catalogItems.find((candidate) => candidate.skuCode === normalized || candidate.barcode === normalized);
    const sku = document.getElementById("receivingSku");
    const search = document.getElementById("receivingSkuSearch");
    const results = document.getElementById("receivingSkuResults");
    const selected = document.getElementById("receivingSelectedSku");

    if (!item || !sku || !search || !selected) return false;
    sku.value = item.skuCode;
    search.value = item.skuCode;
    if (results) results.hidden = true;
    selected.hidden = false;
    selected.innerHTML = `<span class="np-item-thumb">${escapeHtml(item.skuCode.slice(0, 2))}</span><span><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.skuCode)} · 1 ${escapeHtml(item.packageUnit)} = ${formatQuantity(item.unitsPerPack)} ${escapeHtml(item.baseUnit)}</small></span><button type="button" data-clear-receiving-sku aria-label="Choose another material"><i class="bi bi-x-lg"></i></button>`;
    updateReceivingPreview();
    const quantity = document.getElementById("receivingPackageQty");
    quantity?.focus();
    quantity?.select();
    return true;
  }

  function clearSelectedSku({ focus = true } = {}) {
    const sku = document.getElementById("receivingSku");
    const search = document.getElementById("receivingSkuSearch");
    const results = document.getElementById("receivingSkuResults");
    const selected = document.getElementById("receivingSelectedSku");
    if (sku) sku.value = "";
    if (search) search.value = "";
    if (selected) selected.hidden = true;
    if (results) results.hidden = true;
    renderSkuResults();
    updateReceivingPreview();
    if (focus) search?.focus();
  }

  function filterSkuResults() {
    const sku = document.getElementById("receivingSku");
    const results = document.getElementById("receivingSkuResults");
    const selected = document.getElementById("receivingSelectedSku");
    if (sku) sku.value = "";
    if (selected) selected.hidden = true;
    if (results) results.hidden = !document.getElementById("receivingSkuSearch")?.value.trim();
    renderSkuResults();

    const query = document.getElementById("receivingSkuSearch")?.value.trim() || "";
    const exact = catalogItems.find((item) => item.skuCode.toLocaleLowerCase("tr-TR") === query.toLocaleLowerCase("tr-TR") || item.barcode === query);
    if (exact) selectSku(exact.skuCode);
  }

  function findSelectedItem() {
    const skuCode = document.getElementById("receivingSku")?.value || "";
    return catalogItems.find((item) => item.skuCode === skuCode) || null;
  }

  function getPackageQuantity() {
    return Number(document.getElementById("receivingPackageQty")?.value || 0);
  }

  function isNotesRequired() {
    return document.getElementById("receivingReason")?.value !== "MAL_KABUL";
  }

  function updateNotesRequirement() {
    const notes = document.getElementById("receivingNotes");
    const label = document.getElementById("receivingNotesLabel");
    const required = isNotesRequired();

    if (notes) {
      notes.required = required;
      notes.placeholder = required ? "Required for this reason" : "Optional note";
    }

    if (label) {
      label.textContent = required ? "Notes required" : "Notes";
    }
  }

  function calculateBaseQuantity(item, packageQuantity) {
    return Number(packageQuantity || 0) * Number(item?.unitsPerPack || 1);
  }

  function sameMeasurement(left, right) {
    return left.unit === right.unit && Math.abs(Number(left.quantity) - Number(right.quantity)) < 0.0001;
  }

  function formatMeasurement(measurement) {
    return `${formatQuantity(measurement.quantity)} ${measurement.unit}`;
  }

  function buildReceivingExplanation(item, packageQuantity) {
    if (!item) {
      return "Select a SKU and package quantity to see what will be received.";
    }

    if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) {
      return "Enter package quantity to see the received base quantity.";
    }

    const baseQuantity = calculateBaseQuantity(item, packageQuantity);
    const measurements = [{
      quantity: packageQuantity,
      unit: item.packageUnit
    }];

    if (item.innerUnit && Number(item.innerQtyPerPack || 0) !== 1) {
      const innerQuantity = packageQuantity * Number(item.innerQtyPerPack || 0);

      if (innerQuantity > 0) {
        measurements.push({
          quantity: innerQuantity,
          unit: item.innerUnit
        });
      }
    }

    const baseMeasurement = {
      quantity: baseQuantity,
      unit: item.baseUnit
    };

    if (!sameMeasurement(measurements[measurements.length - 1], baseMeasurement)) {
      measurements.push(baseMeasurement);
    }

    return `${formatMeasurement(measurements[0])} ${item.description}${measurements.length > 1 ? ` = ${measurements.slice(1).map(formatMeasurement).join(" = ")}` : ""} will be received.`;
  }

  function updateReceivingPreview() {
    const preview = document.getElementById("receivingPackagePreview");
    const item = findSelectedItem();
    const packageQuantity = getPackageQuantity();

    if (preview) {
      preview.textContent = buildReceivingExplanation(item, packageQuantity);
    }
  }

  function renderLines() {
    const body = document.getElementById("receivingLineBody");
    const mobileList = document.getElementById("receivingMobileList");
    const postButton = document.getElementById("postReceiving");
    const draft = document.getElementById("receivingDraft");
    const draftLines = document.getElementById("receivingDraftLines");

    if (postButton) {
      postButton.disabled = lines.length === 0;
    }

    if (draft) draft.hidden = lines.length === 0;

    if (draftLines) {
      draftLines.innerHTML = lines.length
        ? lines.map((line, index) => `<button type="button" data-remove-receiving-line="${index}" title="Remove ${escapeHtml(line.skuCode)}"><strong>${escapeHtml(line.skuCode)}</strong><span>${formatQuantity(line.packageQuantity)} ${escapeHtml(line.packageUnit)}</span><i class="bi bi-x"></i></button>`).join("")
        : "";
    }

    if (!body) {
      return;
    }

    if (lines.length === 0) {
      body.innerHTML = `<tr><td colspan="9" class="np-empty-cell">No receiving lines added.</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">No receiving lines added.</div>`;
      return;
    }

    body.innerHTML = lines.map((line, index) => `
      <tr>
        <td><strong>${escapeHtml(line.skuCode)}</strong></td>
        <td>${escapeHtml(line.description)}</td>
        <td>${escapeHtml(reasonLabels[line.reasonCode] || line.reasonCode)}</td>
        <td class="text-end"><strong>${formatQuantity(line.packageQuantity)}</strong></td>
        <td>${escapeHtml(line.packageUnit)}</td>
        <td class="text-end"><strong>${formatQuantity(line.baseQuantity)}</strong></td>
        <td>${escapeHtml(line.baseUnit)}</td>
        <td>${escapeHtml(line.notes || "")}</td>
        <td class="text-end">
          <button class="np-row-action" type="button" data-remove-receiving-line="${index}" aria-label="Remove line">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `).join("");

    if (mobileList) mobileList.innerHTML = lines.map((line, index) => `
      <article class="np-mobile-record-card">
        <div class="np-mobile-record-head"><div class="np-mobile-record-title"><strong>${escapeHtml(line.description)}</strong><span>${escapeHtml(line.skuCode)}</span></div><button class="np-row-action" type="button" data-remove-receiving-line="${index}" aria-label="Remove line"><i class="bi bi-trash"></i></button></div>
        <p class="np-mobile-record-copy">${escapeHtml(reasonLabels[line.reasonCode] || line.reasonCode)}${line.notes ? ` · ${escapeHtml(line.notes)}` : ""}</p>
        <div class="np-mobile-record-grid">
          <div class="np-mobile-record-metric"><span>Packages</span><strong>${formatQuantity(line.packageQuantity)} ${escapeHtml(line.packageUnit)}</strong></div>
          <div class="np-mobile-record-metric"><span>Base quantity</span><strong>${formatQuantity(line.baseQuantity)} ${escapeHtml(line.baseUnit)}</strong></div>
        </div>
      </article>`).join("");
  }

  function clearLineInputs() {
    clearSelectedSku({ focus: false });
    document.getElementById("receivingReason").value = "MAL_KABUL";
    document.getElementById("receivingPackageQty").value = "1";
    document.getElementById("receivingNotes").value = "";
    updateReceivingPreview();
    updateNotesRequirement();
  }

  function addLine(event) {
    event.preventDefault();
    showMessage("");

    const item = findSelectedItem();
    const reasonCode = document.getElementById("receivingReason")?.value || "";
    const packageQuantity = getPackageQuantity();
    const notes = document.getElementById("receivingNotes")?.value.trim() || "";

    if (!item) {
      showMessage("Select a SKU before adding a receiving line.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("receivingSkuSearch"), "Search for and select a material.");
      return;
    }

    if (lines.some((line) => line.skuCode === item.skuCode)) {
      showMessage(`${item.skuCode} is already added to this receipt. Remove the existing line before adding it again.`, "error");
      return;
    }

    if (!reasonCode) {
      showMessage("Reason is required.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("receivingReason"), "Choose why this stock is being received.");
      return;
    }

    if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) {
      showMessage("Package quantity must be greater than zero.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("receivingPackageQty"), "Enter at least one package.");
      return;
    }

    if (reasonCode !== "MAL_KABUL" && !notes) {
      showMessage("Notes are required when reason is not Mal Kabul.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("receivingNotes"), "Explain this inventory adjustment.");
      return;
    }

    lines.push({
      skuCode: item.skuCode,
      description: item.description,
      reasonCode,
      packageQuantity,
      packageUnit: item.packageUnit,
      innerUnit: item.innerUnit,
      innerQtyPerPack: item.innerQtyPerPack,
      baseQtyPerInner: item.baseQtyPerInner,
      unitsPerPack: item.unitsPerPack,
      baseQuantity: calculateBaseQuantity(item, packageQuantity),
      baseUnit: item.baseUnit,
      notes
    });

    clearLineInputs();
    renderLines();
    focusReceivingSku();
  }

  function removeLine(index) {
    lines = lines.filter((_, lineIndex) => lineIndex !== index);
    renderSkuResults();
    updateReceivingPreview();
    renderLines();
  }

  function reset() {
    lines = [];
    document.getElementById("receivingDate").value = today();
    document.getElementById("receivingSupplier").value = "";
    document.getElementById("receivingReference").value = "";
    document.getElementById("receivingLocation").value = "FACTORY";
    clearLineInputs();
    showMessage("");
    renderLines();
  }

  function buildPayload() {
    return {
      receiptDate: document.getElementById("receivingDate")?.value || today(),
      supplierName: document.getElementById("receivingSupplier")?.value.trim() || null,
      referenceNo: document.getElementById("receivingReference")?.value.trim() || null,
      locationCode: document.getElementById("receivingLocation")?.value || "FACTORY",
      lines: lines.map((line) => ({
        skuCode: line.skuCode,
        reasonCode: line.reasonCode,
        packageQuantity: line.packageQuantity,
        packageUnit: line.packageUnit,
        innerUnit: line.innerUnit || null,
        innerQtyPerPack: line.innerQtyPerPack || null,
        baseQtyPerInner: line.baseQtyPerInner || null,
        unitsPerPack: line.unitsPerPack,
        baseQuantity: line.baseQuantity,
        baseUnit: line.baseUnit,
        notes: line.notes || null
      }))
    };
  }

  async function postReceipt() {
    if (lines.length === 0) {
      return;
    }

    const button = document.getElementById("postReceiving");
    const originalText = button?.innerHTML;

    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Posting`;
    }

    try {
      await window.NextPulse.api.post(RECEIVING_ENDPOINT, buildPayload());
      reset();
      showMessage("Receipt posted successfully.", "success");
      await Promise.allSettled([
        window.NextPulse.inventory?.refresh?.(),
        reloadCatalog()
      ]);
    } catch (exception) {
      showMessage(
        `${exception.message || "Unable to post receipt."} Endpoint: POST ${RECEIVING_ENDPOINT}`,
        "error"
      );
      renderLines();
    } finally {
      if (button) {
        button.innerHTML = originalText;
        button.disabled = lines.length === 0;
      }
    }
  }

  function initDefaults() {
    const date = document.getElementById("receivingDate");

    if (date && !date.value) {
      date.value = today();
    }
  }

  function focusReceivingSku() {
    window.setTimeout(() => {
      document.getElementById("receivingSkuSearch")?.focus();
    }, 0);
  }

  async function prefillSku(skuCode) {
    await loadCatalog();

    window.setTimeout(() => {
      const quantity = document.getElementById("receivingPackageQty");

      if (skuCode) selectSku(skuCode);

      if (quantity && !quantity.value) {
        quantity.value = "1";
      }

      updateReceivingPreview();
      quantity?.focus();
      quantity?.select();
    }, 0);
  }

  function stopScannerCamera() {
    if (barcodeFrameRequest) window.cancelAnimationFrame(barcodeFrameRequest);
    barcodeFrameRequest = null;
    barcodeControls?.stop?.();
    barcodeControls = null;
    barcodeStream?.getTracks().forEach((track) => track.stop());
    barcodeStream = null;
    const video = document.getElementById("receivingBarcodeVideo");
    if (video) video.srcObject = null;
  }

  function showScannedActions(item) {
    scannedItem = item;
    stopScannerCamera();
    document.querySelector("#receivingScanSheet .np-barcode-reader").hidden = true;
    document.getElementById("receivingScanHelp").hidden = true;
    const result = document.getElementById("receivingScanResult");
    result.hidden = false;
    document.getElementById("receivingScanResultThumb").textContent = item.skuCode.slice(0, 2);
    document.getElementById("receivingScanResultName").textContent = item.description;
    document.getElementById("receivingScanResultSku").textContent = item.skuCode;
    const receiveAction = document.querySelector('[data-scan-action="receive"]');
    if (receiveAction) {
      receiveAction.disabled = isFinishedGood(item.categoryCode);
      receiveAction.title = receiveAction.disabled
        ? "Finished goods enter inventory through Manufacturing"
        : "Receive this item";
    }
  }

  async function handleScannedValue(value) {
    const normalizedValue = normalizeBarcode(value);
    const item = scanCatalogItems.find((candidate) =>
      candidate.skuCode.toUpperCase() === String(value || "").trim().toUpperCase()
      || normalizeBarcode(candidate.barcode) === normalizedValue
    );
    if (!item) {
      const help = document.getElementById("receivingScanHelp");
      if (help) help.textContent = `Barcode ${value} is not assigned to an SKU.`;
      return false;
    }
    if (scannerActionMode) {
      showScannedActions(item);
      return true;
    }
    if (selectSku(item.skuCode)) {
      await closeBarcodeScanner();
      showMessage("Material scanned and selected.", "success");
      return true;
    }
    return false;
  }

  async function openBarcodeScanner(options = {}) {
    const sheet = document.getElementById("receivingScanSheet");
    const video = document.getElementById("receivingBarcodeVideo");
    const help = document.getElementById("receivingScanHelp");
    if (!sheet || !video) return;

    if (hasLoaded) {
      await refreshScanCatalog();
    } else {
      await loadCatalog();
    }
    scannerActionMode = Boolean(options.actionMode);
    scannedItem = null;
    stopScannerCamera();
    document.querySelector("#receivingScanSheet .np-barcode-reader").hidden = false;
    document.getElementById("receivingScanResult").hidden = true;
    help.hidden = false;
    help.textContent = "Place the barcode inside the camera frame.";

    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    if (!navigator.mediaDevices?.getUserMedia) {
      if (help) help.textContent = "Camera access is not supported by this browser. Type the SKU or use a handheld scanner.";
      return;
    }

    try {
      if (!("BarcodeDetector" in window) && window.ZXingBrowser?.BrowserMultiFormatReader) {
        const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
        barcodeControls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          video,
          (result) => {
            const value = result?.getText?.()?.trim();
            if (value) handleScannedValue(value);
          }
        );
        if (help) help.textContent = "Scanner ready · UPC, EAN, Code 128, QR and Data Matrix supported.";
        return;
      }

      if (!("BarcodeDetector" in window)) {
        throw new Error("No barcode decoder is available.");
      }

      barcodeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = barcodeStream;
      await video.play();
      const desiredFormats = ["code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8", "itf", "upc_a", "upc_e", "qr_code", "data_matrix", "aztec", "pdf417"];
      const supportedFormats = typeof window.BarcodeDetector.getSupportedFormats === "function"
        ? await window.BarcodeDetector.getSupportedFormats()
        : desiredFormats;
      const formats = desiredFormats.filter((format) => supportedFormats.includes(format));
      const detector = new window.BarcodeDetector({ formats });
      if (help) help.textContent = "Scan a UPC/EAN/Code 128 barcode, QR, Data Matrix, Aztec, or PDF417 code.";

      const detectFrame = async () => {
        if (!barcodeStream) return;
        try {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue?.trim();
          if (value) {
            if (await handleScannedValue(value)) return;
          }
        } catch {}
        barcodeFrameRequest = window.requestAnimationFrame(detectFrame);
      };

      barcodeFrameRequest = window.requestAnimationFrame(detectFrame);
    } catch {
      barcodeStream?.getTracks().forEach((track) => track.stop());
      barcodeStream = null;
      video.srcObject = null;
      if (help) help.textContent = "Camera could not start. Allow camera access, or type the SKU instead.";
    }
  }

  async function closeBarcodeScanner() {
    const sheet = document.getElementById("receivingScanSheet");
    const video = document.getElementById("receivingBarcodeVideo");
    stopScannerCamera();
    if (sheet) {
      sheet.hidden = true;
      sheet.setAttribute("aria-hidden", "true");
    }
  }

  async function handleScanAction(action) {
    const item = scannedItem;
    if (!item) return;
    await closeBarcodeScanner();
    if (action === "receive") {
      window.NextPulse.ui.showPage("receiving", "Receiving");
      await prefillSku(item.skuCode);
    } else if (action === "use") {
      window.NextPulse.ui.showPage("inventory", "Use Material");
      await window.NextPulse.inventory?.prefillUse?.(item.skuCode);
    } else if (action === "transfer") {
      window.NextPulse.ui.showPage("transfers", "Transfers");
      await window.NextPulse.transfer?.prefillSku?.(item.skuCode);
    }
  }

  function init() {
    initDefaults();
    const details = document.querySelector(".np-receiving-details");
    if (details && window.matchMedia("(min-width: 768px)").matches) details.open = true;
    renderLines();
    updateReceivingPreview();
    updateNotesRequirement();

    document.getElementById("receivingSkuSearch")?.addEventListener("input", filterSkuResults);
    document.getElementById("receivingSkuSearch")?.addEventListener("focus", () => {
      const results = document.getElementById("receivingSkuResults");
      const query = document.getElementById("receivingSkuSearch")?.value.trim();
      if (!findSelectedItem() && results) results.hidden = !query;
    });
    document.getElementById("receivingPackageQty")?.addEventListener("input", updateReceivingPreview);
    document.getElementById("receivingReason")?.addEventListener("change", updateNotesRequirement);
    document.getElementById("receivingForm")?.addEventListener("submit", addLine);
    document.getElementById("resetReceiving")?.addEventListener("click", reset);
    document.getElementById("postReceiving")?.addEventListener("click", postReceipt);
    document.getElementById("receivingScanBarcode")?.addEventListener("click", openBarcodeScanner);
    document.getElementById("receivingScanClose")?.addEventListener("click", closeBarcodeScanner);
    document.getElementById("receivingScanAgain")?.addEventListener("click", () => openBarcodeScanner({ actionMode: true }));
    document.getElementById("receivingScanSheet")?.addEventListener("click", (event) => {
      if (event.target.id === "receivingScanSheet") closeBarcodeScanner();
    });

    document.addEventListener("click", (event) => {
      const scanAction = event.target.closest("[data-scan-action]");
      if (scanAction) {
        handleScanAction(scanAction.dataset.scanAction);
        return;
      }
      const skuOption = event.target.closest("[data-receiving-sku]");
      if (skuOption) {
        selectSku(skuOption.dataset.receivingSku);
        return;
      }

      if (event.target.closest("[data-clear-receiving-sku]")) {
        clearSelectedSku();
        return;
      }

      const button = event.target.closest("[data-remove-receiving-line]");

      if (!button) {
        return;
      }

      removeLine(Number(button.dataset.removeReceivingLine));
    });

    document.addEventListener("nextpulse:page-change", (event) => {
      if (event.detail?.page === "receiving") {
        loadCatalog();
        focusReceivingSku();
      }
    });
  }

  return {
    init,
    loadCatalog,
    prefillSku,
    openScanner: openBarcodeScanner
  };
})();

window.NextPulse = window.NextPulse || {};

window.NextPulse.receiving = (() => {
  const RECEIVING_ENDPOINT = "/receiving/receipts";
  let catalogItems = [];
  let lines = [];
  let hasLoaded = false;
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

  function isFinishedGood(categoryCode) {
    const normalized = String(categoryCode || "").toUpperCase();
    return ["MAMUL", "FINISHED_GOOD", "FINISHED GOOD", "FG"].includes(normalized);
  }

  async function loadCatalog() {
    const select = document.getElementById("receivingSku");

    if (hasLoaded || !select) {
      return;
    }

    try {
      const rows = await window.NextPulse.api.get("/inventory/summary");
      catalogItems = normalizeCatalogRows(Array.isArray(rows) ? rows : []);
      hasLoaded = true;
      renderSkuOptions();
      updateReceivingPreview();
    } catch (exception) {
      select.innerHTML = `<option value="">Unable to load SKUs</option>`;
      showMessage(exception.message || "Unable to load catalog items for receiving.", "error");
    }
  }

  async function reloadCatalog() {
    hasLoaded = false;
    await loadCatalog();
  }

  function renderSkuOptions() {
    const select = document.getElementById("receivingSku");

    if (!select) {
      return;
    }

    const currentValue = select.value;
    const usedSkus = new Set(lines.map((line) => line.skuCode));
    const availableItems = catalogItems.filter((item) => !usedSkus.has(item.skuCode));

    if (catalogItems.length === 0) {
      select.innerHTML = `<option value="">No SKUs available</option>`;
      return;
    }

    if (availableItems.length === 0) {
      select.innerHTML = `<option value="">All available SKUs added</option>`;
      return;
    }

    select.innerHTML = [
      `<option value="">Select SKU</option>`,
      ...availableItems.map((item) => `
        <option value="${escapeHtml(item.skuCode)}">
          ${escapeHtml(item.skuCode)} - ${escapeHtml(item.description)}
        </option>
      `)
    ].join("");

    if (availableItems.some((item) => item.skuCode === currentValue)) {
      select.value = currentValue;
    }
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
    const postButton = document.getElementById("postReceiving");
    const lineCount = document.getElementById("receivingLineCount");
    const totalPackages = document.getElementById("receivingTotalPackages");
    const totalBaseQuantity = document.getElementById("receivingTotalBaseQty");

    if (postButton) {
      postButton.disabled = lines.length === 0;
    }

    if (lineCount) {
      lineCount.textContent = lines.length === 0
        ? "No lines yet"
        : `${lines.length} line${lines.length === 1 ? "" : "s"} ready`;
    }

    if (totalPackages) {
      const total = lines.reduce((sum, line) => sum + line.packageQuantity, 0);
      totalPackages.textContent = formatQuantity(total);
    }

    if (totalBaseQuantity) {
      const total = lines.reduce((sum, line) => sum + line.baseQuantity, 0);
      totalBaseQuantity.textContent = formatQuantity(total);
    }

    if (!body) {
      return;
    }

    if (lines.length === 0) {
      body.innerHTML = `<tr><td colspan="9" class="np-empty-cell">No receiving lines added.</td></tr>`;
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
  }

  function clearLineInputs() {
    renderSkuOptions();
    document.getElementById("receivingSku").value = "";
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
      return;
    }

    if (lines.some((line) => line.skuCode === item.skuCode)) {
      showMessage(`${item.skuCode} is already added to this receipt. Remove the existing line before adding it again.`, "error");
      return;
    }

    if (!reasonCode) {
      showMessage("Reason is required.", "error");
      return;
    }

    if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) {
      showMessage("Package quantity must be greater than zero.", "error");
      return;
    }

    if (reasonCode !== "MAL_KABUL" && !notes) {
      showMessage("Notes are required when reason is not Mal Kabul.", "error");
      document.getElementById("receivingNotes")?.focus();
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
    renderSkuOptions();
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
      document.getElementById("receivingSku")?.focus();
    }, 0);
  }

  async function prefillSku(skuCode) {
    await loadCatalog();

    window.setTimeout(() => {
      const sku = document.getElementById("receivingSku");
      const quantity = document.getElementById("receivingPackageQty");

      if (skuCode && sku) {
        sku.value = skuCode;
      }

      if (quantity && !quantity.value) {
        quantity.value = "1";
      }

      updateReceivingPreview();
      quantity?.focus();
      quantity?.select();
    }, 0);
  }

  function init() {
    initDefaults();
    renderLines();
    updateReceivingPreview();
    updateNotesRequirement();

    document.getElementById("receivingSku")?.addEventListener("change", updateReceivingPreview);
    document.getElementById("receivingPackageQty")?.addEventListener("input", updateReceivingPreview);
    document.getElementById("receivingReason")?.addEventListener("change", updateNotesRequirement);
    document.getElementById("receivingForm")?.addEventListener("submit", addLine);
    document.getElementById("resetReceiving")?.addEventListener("click", reset);
    document.getElementById("postReceiving")?.addEventListener("click", postReceipt);

    document.addEventListener("click", (event) => {
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
    prefillSku
  };
})();

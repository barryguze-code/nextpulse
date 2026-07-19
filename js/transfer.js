window.NextPulse = window.NextPulse || {};

window.NextPulse.transfer = (() => {
  const TRANSFER_ENDPOINT = "/transfers";
  let catalogItems = [];
  let locations = [];
  let lines = [];
  let hasLoaded = false;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function isWholeUnit(unit) {
    return ["ADET", "AD", "KOLI", "KOLİ", "TORBA", "RULO", "PAKET", "PALET", "BALYA"]
      .includes(String(unit || "").trim().toUpperCase());
  }

  function formatQuantity(value, unit = "") {
    const digits = isWholeUnit(unit) ? 0 : 2;

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
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

  function isFinishedGood(categoryCode) {
    const normalized = String(categoryCode || "").toUpperCase();
    return ["MAMUL", "FINISHED_GOOD", "FINISHED GOOD", "FG"].includes(normalized);
  }

  function locationLabel(code) {
    return locations.find((location) => location.locationCode === code)?.locationName || code || "";
  }

  function findLocationCode(...patterns) {
    const upperPatterns = patterns.map((pattern) => String(pattern).toUpperCase());
    const found = locations.find((location) => {
      const haystack = `${location.locationCode || ""} ${location.locationName || ""}`.toUpperCase();
      return upperPatterns.some((pattern) => haystack.includes(pattern));
    });

    return found?.locationCode || "";
  }

  function getPackUnit(item) {
    return item?.packageUnit || item?.packUnit || item?.containerUnit || item?.baseUnit || "";
  }

  function getBaseUnit(item) {
    return item?.baseUnit || item?.unit || "";
  }

  function getUnitsPerPack(item) {
    return Number(item?.unitsPerPack || item?.unitsPerPackage || item?.expectedBaseQuantityPerContainer || item?.packSize || 1) || 1;
  }

  function normalizeInventoryRows(rows) {
    const grouped = new Map();
    const locationMap = new Map();

    rows.forEach((row) => {
      const skuCode = row.skuCode || row.itemCode || "";
      const locationCode = row.locationCode || "";

      if (locationCode && !locationMap.has(locationCode)) {
        locationMap.set(locationCode, {
          locationCode,
          locationName: row.locationName || locationCode
        });
      }

      if (!skuCode) {
        return;
      }

      if (!grouped.has(skuCode)) {
        grouped.set(skuCode, {
          skuCode,
          description: row.description || "",
          categoryCode: row.categoryCode || "",
          baseUnit: row.baseUnit || row.unit || "",
          packageUnit: row.packUnit || row.packageUnit || row.containerUnit || row.unit || row.baseUnit || "",
          unitsPerPack: getUnitsPerPack(row),
          locationRows: []
        });
      }

      grouped.get(skuCode).locationRows.push({
        locationCode,
        locationName: row.locationName || locationCode,
        currentBaseQuantity: Number(row.currentBaseQuantity || 0),
        currentPackageQuantity: Number(row.currentPackageQuantity || row.currentContainerQuantity || 0)
      });
    });

    locations = Array.from(locationMap.values())
      .sort((left, right) => String(left.locationName).localeCompare(String(right.locationName)));

    return Array.from(grouped.values())
      .sort((left, right) => String(left.description || left.skuCode).localeCompare(String(right.description || right.skuCode)));
  }

  async function loadCatalog() {
    const skuSelect = document.getElementById("transferSku");

    if (hasLoaded || !skuSelect) {
      return;
    }

    try {
      const rows = await window.NextPulse.api.get("/inventory/summary");
      catalogItems = normalizeInventoryRows(Array.isArray(rows) ? rows : []);
      hasLoaded = true;
      renderSkuOptions();
      renderLocationOptions();
      applySmartLocationDefaults();
      updateMode();
      updatePreview();
    } catch (exception) {
      skuSelect.innerHTML = `<option value="">Unable to load SKUs</option>`;
      showMessage(exception.message || "Unable to load transfer data.", "error");
    }
  }

  async function reloadCatalog() {
    hasLoaded = false;
    await loadCatalog();
  }

  function renderSkuOptions() {
    const select = document.getElementById("transferSku");
    const currentValue = select?.value || "";

    if (!select) {
      return;
    }

    if (catalogItems.length === 0) {
      select.innerHTML = `<option value="">No SKUs available</option>`;
      return;
    }

    select.innerHTML = [
      `<option value="">Select SKU</option>`,
      ...catalogItems.map((item) => `
        <option value="${escapeHtml(item.skuCode)}">
          ${escapeHtml(item.skuCode)} - ${escapeHtml(item.description)}
        </option>
      `)
    ].join("");

    if (catalogItems.some((item) => item.skuCode === currentValue)) {
      select.value = currentValue;
    }
  }

  function renderLocationOptions() {
    const from = document.getElementById("transferFromLocation");
    const to = document.getElementById("transferToLocation");
    const options = [
      `<option value="">Select location</option>`,
      ...locations.map((location) => `
        <option value="${escapeHtml(location.locationCode)}">
          ${escapeHtml(location.locationName || location.locationCode)}
        </option>
      `)
    ].join("");

    [from, to].forEach((select) => {
      if (!select) {
        return;
      }

      const currentValue = select.value;
      select.innerHTML = options;
      if (locations.some((location) => location.locationCode === currentValue)) {
        select.value = currentValue;
      }
    });
  }

  function selectedItem() {
    const skuCode = document.getElementById("transferSku")?.value || "";
    return catalogItems.find((item) => item.skuCode === skuCode) || null;
  }

  function selectedFromLocation() {
    return document.getElementById("transferFromLocation")?.value || "";
  }

  function selectedToLocation() {
    return document.getElementById("transferToLocation")?.value || "";
  }

  function sourceBaseStock(item, locationCode) {
    return Number(item?.locationRows?.find((row) => row.locationCode === locationCode)?.currentBaseQuantity || 0);
  }

  function draftedBaseQuantity(item, locationCode) {
    return lines
      .filter((line) => line.skuCode === item?.skuCode && line.fromLocationCode === locationCode)
      .reduce((sum, line) => sum + Number(line.baseQuantity || 0), 0);
  }

  function remainingBaseStock(item, locationCode) {
    return sourceBaseStock(item, locationCode) - draftedBaseQuantity(item, locationCode);
  }

  function packageQuantity() {
    return Number(document.getElementById("transferPackageQty")?.value || 0);
  }

  function palletQuantity() {
    return Number(document.getElementById("transferPalletQty")?.value || 0);
  }

  function boxesPerPallet() {
    return Number(document.getElementById("transferBoxesPerPallet")?.value || 0);
  }

  function unitsPerBox() {
    return Number(document.getElementById("transferUnitsPerBox")?.value || 0);
  }

  function isFinishedSelected() {
    return isFinishedGood(selectedItem()?.categoryCode);
  }

  function materialBaseQuantity(item) {
    return packageQuantity() * getUnitsPerPack(item);
  }

  function finishedBaseQuantity() {
    return palletQuantity() * boxesPerPallet() * unitsPerBox();
  }

  function finishedContainerQuantity(item) {
    const unitsPerPack = getUnitsPerPack(item);
    return unitsPerPack > 0 ? finishedBaseQuantity() / unitsPerPack : finishedBaseQuantity();
  }

  function updateMode() {
    const finished = isFinishedSelected();

    document.querySelectorAll("[data-transfer-material-field]").forEach((field) => {
      field.hidden = finished;
    });

    document.querySelectorAll("[data-transfer-finished-field]").forEach((field) => {
      field.hidden = !finished;
    });
  }

  function applySmartLocationDefaults() {
    const from = document.getElementById("transferFromLocation");
    const to = document.getElementById("transferToLocation");
    const item = selectedItem();

    if (!from || !to || locations.length === 0) {
      return;
    }

    const factory = findLocationCode("FACTORY", "FABRIKA");
    const production = findLocationCode("PRODUCTION_AREA", "ÜRETIM", "URETIM");
    const bim = findLocationCode("BIM", "ARA");
    const target = findLocationCode("HEDEF");

    if (!from.value) {
      from.value = factory || locations[0]?.locationCode || "";
    }

    if (isFinishedGood(item?.categoryCode)) {
      if (!to.value || to.value === production) {
        to.value = from.value === bim
          ? (target || locations.find((location) => location.locationCode !== from.value)?.locationCode || "")
          : (bim || locations.find((location) => location.locationCode !== from.value)?.locationCode || "");
      }
      return;
    }

    if (!to.value) {
      to.value = production || locations.find((location) => location.locationCode !== from.value)?.locationCode || "";
    }
  }

  function applyFinishedGoodDestinationFromSource() {
    const item = selectedItem();
    const from = document.getElementById("transferFromLocation");
    const to = document.getElementById("transferToLocation");

    if (!isFinishedGood(item?.categoryCode) || !from || !to) {
      return;
    }

    const bim = findLocationCode("BIM", "ARA");
    const target = findLocationCode("HEDEF");

    if (bim && target && from.value === bim) {
      to.value = target;
    }
  }

  function showMessage(message, type = "") {
    const element = document.getElementById("transferMessage");

    if (!element) {
      return;
    }

    element.hidden = !message;
    element.textContent = message || "";
    element.className = `np-alert${type ? ` is-${type}` : ""}`;
  }

  function buildPreview() {
    const item = selectedItem();
    const from = selectedFromLocation();
    const to = selectedToLocation();

    if (!item) {
      return "Select a SKU to start the transfer.";
    }

    if (!from || !to) {
      return "Select source and destination locations.";
    }

    if (from === to) {
      return "Source and destination must be different.";
    }

    if (isFinishedGood(item.categoryCode)) {
      const baseQty = finishedBaseQuantity();

      if (baseQty <= 0) {
        return "Enter pallet, box, and unit quantities.";
      }

      return `${formatQuantity(palletQuantity(), "PALET")} PALET x ${formatQuantity(boxesPerPallet(), "KOLI")} KOLI x ${formatQuantity(unitsPerBox(), getBaseUnit(item))} ${getBaseUnit(item)} = ${formatQuantity(baseQty, getBaseUnit(item))} ${getBaseUnit(item)} will move ${locationLabel(from)} → ${locationLabel(to)}.`;
    }

    const baseQty = materialBaseQuantity(item);

    if (baseQty <= 0) {
      return "Enter package quantity.";
    }

    return `${formatQuantity(packageQuantity(), getPackUnit(item))} ${getPackUnit(item)} ${item.description} = ${formatQuantity(baseQty, getBaseUnit(item))} ${getBaseUnit(item)} will move ${locationLabel(from)} → ${locationLabel(to)}.`;
  }

  function updatePreview() {
    const preview = document.getElementById("transferPreview");

    if (preview) {
      preview.textContent = buildPreview();
    }
  }

  function buildLine() {
    const item = selectedItem();
    const from = selectedFromLocation();
    const to = selectedToLocation();
    const notes = document.getElementById("transferLineNotes")?.value.trim() || "";

    if (!item || !from || !to || from === to) {
      return null;
    }

    if (isFinishedGood(item.categoryCode)) {
      const baseQuantity = finishedBaseQuantity();
      const palletQty = palletQuantity();
      const boxQty = boxesPerPallet();
      const unitQty = unitsPerBox();

      if (baseQuantity <= 0 || palletQty <= 0 || boxQty <= 0 || unitQty <= 0) {
        return null;
      }

      return {
        skuCode: item.skuCode,
        description: item.description,
        categoryCode: item.categoryCode,
        transferMode: "FINISHED_GOOD",
        fromLocationCode: from,
        toLocationCode: to,
        packageQuantity: finishedContainerQuantity(item),
        packageUnit: getPackUnit(item),
        unitsPerPack: getUnitsPerPack(item),
        baseQuantity,
        baseUnit: getBaseUnit(item),
        palletQuantity: palletQty,
        boxesPerPallet: boxQty,
        unitsPerBox: unitQty,
        summary: `${formatQuantity(palletQty, "PALET")} PALET x ${formatQuantity(boxQty, "KOLI")} KOLI x ${formatQuantity(unitQty, getBaseUnit(item))} ${getBaseUnit(item)}`,
        notes
      };
    }

    const baseQuantity = materialBaseQuantity(item);

    if (packageQuantity() <= 0 || baseQuantity <= 0) {
      return null;
    }

    return {
      skuCode: item.skuCode,
      description: item.description,
      categoryCode: item.categoryCode,
      transferMode: "MATERIAL",
      fromLocationCode: from,
      toLocationCode: to,
      packageQuantity: packageQuantity(),
      packageUnit: getPackUnit(item),
      unitsPerPack: getUnitsPerPack(item),
      baseQuantity,
      baseUnit: getBaseUnit(item),
      palletQuantity: null,
      boxesPerPallet: null,
      unitsPerBox: null,
      summary: `${formatQuantity(packageQuantity(), getPackUnit(item))} ${getPackUnit(item)}`,
      notes
    };
  }

  function mergeOrAddLine(nextLine) {
    const match = lines.find((line) =>
      line.skuCode === nextLine.skuCode
      && line.transferMode === nextLine.transferMode
      && line.fromLocationCode === nextLine.fromLocationCode
      && line.toLocationCode === nextLine.toLocationCode
      && Number(line.boxesPerPallet || 0) === Number(nextLine.boxesPerPallet || 0)
      && Number(line.unitsPerBox || 0) === Number(nextLine.unitsPerBox || 0)
      && line.notes === nextLine.notes
    );

    if (!match) {
      lines.push(nextLine);
      return;
    }

    match.packageQuantity += nextLine.packageQuantity;
    match.baseQuantity += nextLine.baseQuantity;

    if (nextLine.transferMode === "FINISHED_GOOD") {
      match.palletQuantity += nextLine.palletQuantity;
      match.summary = `${formatQuantity(match.palletQuantity, "PALET")} PALET x ${formatQuantity(match.boxesPerPallet, "KOLI")} KOLI x ${formatQuantity(match.unitsPerBox, match.baseUnit)} ${match.baseUnit}`;
    } else {
      match.summary = `${formatQuantity(match.packageQuantity, match.packageUnit)} ${match.packageUnit}`;
    }
  }

  function addLine(event) {
    event.preventDefault();
    showMessage("");

    const line = buildLine();
    const item = selectedItem();

    if (!line || !item) {
      showMessage("Complete SKU, locations, and quantity before adding a transfer line.", "error");
      return;
    }

    if (line.baseQuantity > remainingBaseStock(item, line.fromLocationCode) + 0.000001) {
      showMessage(`Not enough stock in ${locationLabel(line.fromLocationCode)} for ${line.skuCode}.`, "error");
      return;
    }

    if (lines.length > 0
      && (lines[0].fromLocationCode !== line.fromLocationCode || lines[0].toLocationCode !== line.toLocationCode)) {
      showMessage("Post or reset the current transfer before changing source or destination.", "error");
      return;
    }

    mergeOrAddLine(line);
    document.getElementById("transferLineNotes").value = "";
    renderLines();
    updatePreview();
    document.getElementById("transferSku")?.focus();
  }

  function removeLine(index) {
    lines = lines.filter((_, lineIndex) => lineIndex !== index);
    renderLines();
    updatePreview();
  }

  function renderLines() {
    const body = document.getElementById("transferLineBody");
    const postButton = document.getElementById("postTransfer");
    const lineCount = document.getElementById("transferLineCount");
    const totalPallets = document.getElementById("transferTotalPallets");
    const totalBaseQty = document.getElementById("transferTotalBaseQty");

    if (postButton) {
      postButton.disabled = lines.length === 0;
    }

    if (lineCount) {
      lineCount.textContent = lines.length === 0
        ? "No lines yet"
        : `${lines.length} line${lines.length === 1 ? "" : "s"} ready`;
    }

    if (totalPallets) {
      const total = lines.reduce((sum, line) => sum + Number(line.palletQuantity || 0), 0);
      totalPallets.textContent = formatQuantity(total, "PALET");
    }

    if (totalBaseQty) {
      const total = lines.reduce((sum, line) => sum + Number(line.baseQuantity || 0), 0);
      totalBaseQty.textContent = formatQuantity(total);
    }

    if (!body) {
      return;
    }

    if (lines.length === 0) {
      body.innerHTML = `<tr><td colspan="8" class="np-empty-cell">No transfer lines added.</td></tr>`;
      return;
    }

    body.innerHTML = lines.map((line, index) => `
      <tr>
        <td><strong>${escapeHtml(line.skuCode)}</strong></td>
        <td>${escapeHtml(line.description)}</td>
        <td>${escapeHtml(locationLabel(line.fromLocationCode))} → ${escapeHtml(locationLabel(line.toLocationCode))}</td>
        <td>${escapeHtml(line.summary)}</td>
        <td class="text-end"><strong>${formatQuantity(line.baseQuantity, line.baseUnit)}</strong></td>
        <td>${escapeHtml(line.baseUnit)}</td>
        <td>${escapeHtml(line.notes || "")}</td>
        <td class="text-end">
          <button class="np-row-action" type="button" data-remove-transfer-line="${index}" aria-label="Remove line">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `).join("");
  }

  function buildPayload() {
    return {
      transferDate: document.getElementById("transferDate")?.value || today(),
      fromLocationCode: lines[0]?.fromLocationCode || selectedFromLocation(),
      toLocationCode: lines[0]?.toLocationCode || selectedToLocation(),
      referenceNo: document.getElementById("transferReference")?.value.trim() || null,
      notes: document.getElementById("transferNotes")?.value.trim() || null,
      lines: lines.map((line) => ({
        skuCode: line.skuCode,
        transferMode: line.transferMode,
        packageQuantity: line.packageQuantity,
        packageUnit: line.packageUnit,
        unitsPerPack: line.unitsPerPack,
        baseQuantity: line.baseQuantity,
        baseUnit: line.baseUnit,
        palletQuantity: line.palletQuantity,
        boxesPerPallet: line.boxesPerPallet,
        unitsPerBox: line.unitsPerBox,
        notes: line.notes || null
      }))
    };
  }

  async function postTransfer() {
    if (lines.length === 0) {
      return;
    }

    const button = document.getElementById("postTransfer");
    const originalText = button?.innerHTML;

    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Posting`;
    }

    try {
      await window.NextPulse.api.post(TRANSFER_ENDPOINT, buildPayload());
      reset();
      showMessage("Transfer posted successfully.", "success");
      await Promise.allSettled([
        window.NextPulse.inventory?.refresh?.(),
        reloadCatalog()
      ]);
    } catch (exception) {
      showMessage(`${exception.message || "Unable to post transfer."} Endpoint: POST ${TRANSFER_ENDPOINT}`, "error");
      renderLines();
    } finally {
      if (button) {
        button.innerHTML = originalText;
        button.disabled = lines.length === 0;
      }
    }
  }

  function reset() {
    lines = [];
    document.getElementById("transferDate").value = today();
    document.getElementById("transferReference").value = "";
    document.getElementById("transferNotes").value = "";
    document.getElementById("transferLineNotes").value = "";
    document.getElementById("transferPackageQty").value = "1";
    document.getElementById("transferPalletQty").value = "1";
    document.getElementById("transferBoxesPerPallet").value = "250";
    document.getElementById("transferUnitsPerBox").value = "12";
    applySmartLocationDefaults();
    showMessage("");
    renderLines();
    updateMode();
    updatePreview();
  }

  async function prefillSku(skuCode) {
    await loadCatalog();

    window.setTimeout(() => {
      const sku = document.getElementById("transferSku");

      if (skuCode && sku) {
        sku.value = skuCode;
      }

      applySmartLocationDefaults();
      updateMode();
      updatePreview();
      document.getElementById(isFinishedSelected() ? "transferPalletQty" : "transferPackageQty")?.focus();
    }, 0);
  }

  function initDefaults() {
    const date = document.getElementById("transferDate");

    if (date && !date.value) {
      date.value = today();
    }
  }

  function init() {
    initDefaults();
    renderLines();
    updatePreview();

    document.getElementById("transferForm")?.addEventListener("submit", addLine);
    document.getElementById("resetTransfer")?.addEventListener("click", reset);
    document.getElementById("postTransfer")?.addEventListener("click", postTransfer);
    document.getElementById("transferSku")?.addEventListener("change", () => {
      applySmartLocationDefaults();
      updateMode();
      updatePreview();
    });

    document.getElementById("transferFromLocation")?.addEventListener("change", () => {
      applyFinishedGoodDestinationFromSource();
      updatePreview();
    });

    document.getElementById("transferToLocation")?.addEventListener("change", updatePreview);

    [
      "transferPackageQty",
      "transferPalletQty",
      "transferBoxesPerPallet",
      "transferUnitsPerBox"
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", updatePreview);
      document.getElementById(id)?.addEventListener("change", updatePreview);
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-transfer-line]");

      if (!button) {
        return;
      }

      removeLine(Number(button.dataset.removeTransferLine));
    });

    document.addEventListener("nextpulse:page-change", (event) => {
      if (event.detail?.page === "transfers") {
        loadCatalog();
        window.setTimeout(() => document.getElementById("transferSku")?.focus(), 0);
      }
    });
  }

  return {
    init,
    loadCatalog,
    prefillSku
  };
})();

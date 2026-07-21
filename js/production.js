window.NextPulse = window.NextPulse || {};

window.NextPulse.production = (() => {
  const DEFAULT_RECIPE_KEY = "nextpulse.production.defaultRecipeVersionId";
  let recipes = [];
  let openBatches = [];
  let recentBatches = [];
  let currentBatch = null;
  let hasLoaded = false;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatQuantity(value) {
    const number = Number(value || 0);

    if (number > 0 && number < 0.005) {
      return "<0.01";
    }

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number);
  }

  function numericValue(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function formatInputQuantity(value) {
    return numericValue(value).toFixed(2);
  }

  function formatPackageInputQuantity(value) {
    return String(Math.max(Math.ceil(numericValue(value) - 0.000001), 0));
  }

  function formatWholeQuantity(value) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 0
    }).format(Math.trunc(Math.max(numericValue(value), 0)));
  }

  function renderPackageQuantityVisual(quantity, unit) {
    const value = Math.max(numericValue(quantity), 0);
    const whole = Math.floor(value + 0.000001);
    const fraction = value - whole;
    const hasFraction = fraction > 0.000001;
    const safeUnit = escapeHtml(unit);

    if (!hasFraction) {
      return `<span class="np-stock-package"><strong>${formatWholeQuantity(value)}</strong> ${safeUnit}</span>`;
    }

    const fillPercent = Math.min(Math.max(fraction * 100, 1), 100).toFixed(2);
    const fractionText = fraction < 0.005 ? "<0.01" : fraction.toFixed(2);
    const wholeLine = whole > 0
      ? `<span class="np-pack-whole"><strong>${formatWholeQuantity(whole)}</strong> ${safeUnit}</span>`
      : "";

    return `
      <span class="np-pack-visual">
        ${wholeLine}
        <span class="np-pack-fraction" style="--np-pack-fill: ${fillPercent}%;">
          <span class="np-pack-fraction-fill"></span>
          <span class="np-pack-fraction-label">${escapeHtml(fractionText)}</span>
        </span>
      </span>
    `;
  }

  function packageInputQuantity(input) {
    return Math.max(Math.ceil(numericValue(input?.value) - 0.000001), 0);
  }

  function normalizePackageInput(input) {
    if (!input || input.value === "") {
      return;
    }

    input.value = formatPackageInputQuantity(input.value);
  }

  function suggestedTransferPackageQuantity(plannedBase, productionBase, basePerContainer) {
    if (basePerContainer <= 0) {
      return 0;
    }

    return Math.max(Math.ceil((plannedBase - productionBase) / basePerContainer - 0.000001), 0);
  }

  function transferBaseQuantity(input) {
    return packageInputQuantity(input) * numericValue(input.dataset.basePerContainer);
  }

  function containerBaseQuantity(input) {
    return numericValue(input.value) * numericValue(input.dataset.basePerContainer);
  }

  function isFactoryTransferShort(input) {
    const transferQty = packageInputQuantity(input);
    const requiredBase = transferBaseQuantity(input);
    const factoryBase = numericValue(input.dataset.factoryOnHandBase);

    return transferQty > 0 && requiredBase > factoryBase + 0.000001;
  }

  function isTotalStockShort(input) {
    const plannedBase = numericValue(input.dataset.plannedBase);
    const factoryBase = numericValue(input.dataset.factoryOnHandBase);
    const productionBase = numericValue(input.dataset.productionOnHandBase);

    return plannedBase > factoryBase + productionBase + 0.000001;
  }

  function isTransferTooLow(input) {
    const plannedBase = numericValue(input.dataset.plannedBase);
    const productionBase = numericValue(input.dataset.productionOnHandBase);
    const transferBase = transferBaseQuantity(input);

    return plannedBase > productionBase + transferBase + 0.000001;
  }

  function isTransferNotNeeded(input) {
    const plannedBase = numericValue(input.dataset.plannedBase);
    const productionBase = numericValue(input.dataset.productionOnHandBase);

    return plannedBase <= productionBase + 0.000001;
  }

  function hasInsufficientTransfer() {
    return Array.from(document.querySelectorAll("[data-production-transfer]"))
      .filter((input) => input.offsetParent !== null)
      .some((input) => isFactoryTransferShort(input) || isTotalStockShort(input) || isTransferTooLow(input));
  }

  function isConsumptionTooHigh(input) {
    return containerBaseQuantity(input) > numericValue(input.dataset.productionOnHandBase) + 0.000001;
  }

  function hasInvalidCompletion() {
    const goodQuantity = numericValue(document.getElementById("productionGoodQuantity")?.value);

    return goodQuantity <= 0
      || Array.from(document.querySelectorAll("[data-production-consume]"))
        .filter((input) => input.offsetParent !== null)
        .some((input) => numericValue(input.value) < 0 || isConsumptionTooHigh(input));
  }

  function stockStatusMessage(input) {
    if (isTotalStockShort(input)) {
      return "Total Factory + Production Area stock is not enough to start production.";
    }

    if (isFactoryTransferShort(input)) {
      return "Factory stock is not enough for the selected transfer quantity.";
    }

    if (isTransferTooLow(input)) {
      return "Selected transfer packages do not cover the remaining production need.";
    }

    if (isTransferNotNeeded(input)) {
      return "No transfer needed. Production Area already has enough stock for this material.";
    }

    return "Ready for production material transfer.";
  }

  function updateTransferWarnings() {
    document.querySelectorAll("[data-production-transfer]").forEach((input) => {
      normalizePackageInput(input);
      const transferShort = isFactoryTransferShort(input);
      const totalShort = isTotalStockShort(input);
      const transferLow = isTransferTooLow(input);
      const transferNotNeeded = isTransferNotNeeded(input);
      const row = input.closest("tr, [data-production-material]");
      const factoryCell = row?.querySelector("[data-production-factory-cell]");
      const productionCell = row?.querySelector("[data-production-area-cell]");
      const requiredCell = row?.querySelector("[data-production-required-cell]");
      const statusIcon = row?.querySelector("[data-production-stock-status]");
      const message = stockStatusMessage(input);

      row?.classList.toggle("is-stock-short", transferShort || totalShort || transferLow);
      input.classList.toggle("is-danger", transferShort || totalShort || transferLow);
      factoryCell?.classList.toggle("is-danger", transferShort);
      productionCell?.classList.remove("is-danger");
      requiredCell?.classList.toggle("is-danger", totalShort);

      if (statusIcon) {
        statusIcon.classList.toggle("is-danger", transferShort || totalShort || transferLow);
        statusIcon.classList.toggle("is-no-need", transferNotNeeded && !transferShort && !totalShort && !transferLow);
        statusIcon.classList.toggle("is-ready", !transferNotNeeded && !transferShort && !totalShort && !transferLow);
        statusIcon.title = message;
        statusIcon.setAttribute("aria-label", message);
        statusIcon.innerHTML = transferShort || totalShort || transferLow
          ? `<i class="bi bi-exclamation-triangle-fill"></i>`
          : (transferNotNeeded
            ? `<i class="bi bi-dash-circle-fill"></i>`
            : `<i class="bi bi-check-circle-fill"></i>`);
      }
    });
  }

  function updateConsumptionWarnings() {
    document.querySelectorAll("[data-production-consume]").forEach((input) => {
      const tooHigh = isConsumptionTooHigh(input);
      const row = input.closest("tr, [data-production-material]");
      const productionCell = row?.querySelector("[data-production-area-cell]");
      const statusIcon = row?.querySelector("[data-production-stock-status]");
      const message = tooHigh
        ? "Production Area stock is not enough for this consumed quantity."
        : "Ready to consume from Production Area.";

      row?.classList.toggle("is-stock-short", tooHigh);
      input.classList.toggle("is-danger", tooHigh);
      productionCell?.classList.toggle("is-danger", tooHigh);

      if (statusIcon) {
        statusIcon.classList.toggle("is-danger", tooHigh);
        statusIcon.classList.toggle("is-ready", !tooHigh);
        statusIcon.title = message;
        statusIcon.setAttribute("aria-label", message);
        statusIcon.innerHTML = tooHigh
          ? `<i class="bi bi-exclamation-triangle-fill"></i>`
          : `<i class="bi bi-check-circle-fill"></i>`;
      }
    });
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
    const elements = [
      document.getElementById("productionTopMessage"),
      document.getElementById("productionMessage")
    ].filter(Boolean);

    if (elements.length === 0) {
      return;
    }

    elements.forEach((element) => {
      element.hidden = !message;
      element.textContent = message || "";
      element.className = `np-alert${element.id === "productionTopMessage" ? " np-panel-top-alert" : ""}${type ? ` is-${type}` : ""}`;
    });
  }

  function showMessageAtTop(message, type = "") {
    showMessage(message, type);
    document.getElementById("productionTopMessage")?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  }

  function selectedRecipe() {
    const recipeVersionId = document.getElementById("productionRecipe")?.value || "";
    return recipes.find((recipe) => recipe.recipeVersionId === recipeVersionId) || null;
  }

  function renderOpenBatchOptions() {
    const select = document.getElementById("productionOpenBatch");

    if (!select) {
      return;
    }

    const currentBatchId = currentBatch?.batch?.productionBatchId || "";

    if (openBatches.length === 0) {
      select.innerHTML = `<option value="">No open production batches</option>`;
      select.value = "";
      return;
    }

    select.innerHTML = [
      `<option value="">Select an open batch</option>`,
      ...openBatches.map((batch) => `
        <option value="${escapeHtml(batch.productionBatchId)}">
          ${escapeHtml(batch.batchNumber)} · ${escapeHtml(batch.finishedDescription)} · ${formatQuantity(batch.plannedOutputQuantity)} · ${escapeHtml(batch.status)}
        </option>
      `)
    ].join("");

    select.value = openBatches.some((batch) => batch.productionBatchId === currentBatchId)
      ? currentBatchId
      : "";
  }

  function statusLabel(status) {
    return String(status || "DRAFT")
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function statusClass(status) {
    return String(status || "DRAFT").toLowerCase().replaceAll("_", "-");
  }

  function renderRecentBatches() {
    const list = document.getElementById("productionRecentBatchList");
    const count = document.getElementById("productionRecentBatchCount");

    if (count) {
      count.textContent = `${recentBatches.length} ${recentBatches.length === 1 ? "batch" : "batches"}`;
    }

    if (!list) {
      return;
    }

    if (recentBatches.length === 0) {
      list.innerHTML = `
        <div class="np-recent-batch-row is-empty">
          Open production batches will appear here.
        </div>
      `;
      return;
    }

    const currentBatchId = currentBatch?.batch?.productionBatchId || "";

    list.innerHTML = recentBatches.map((batch) => {
      const selected = batch.productionBatchId === currentBatchId ? " is-selected" : "";
      const outputQuantity = Number(batch.actualOutputQuantity || batch.plannedOutputQuantity || 0);
      const canCancel = batch.status === "DRAFT" || batch.status === "IN_PROGRESS";
      return `
        <div class="np-recent-batch-row${selected}">
          <button class="np-recent-batch-open" type="button" data-production-recent-batch="${escapeHtml(batch.productionBatchId)}">
            <span class="np-recent-batch-main">
              <strong>${escapeHtml(batch.batchNumber)} · ${escapeHtml(batch.finishedDescription)}</strong>
              <span>${escapeHtml(batch.lotNumber)} · ${escapeHtml(batch.productionDate || "")}</span>
            </span>
            <span class="np-recent-batch-side">
              <span class="np-recent-batch-meta">${formatQuantity(outputQuantity)}</span>
              <span class="np-batch-status is-${escapeHtml(statusClass(batch.status))}">${escapeHtml(statusLabel(batch.status))}</span>
            </span>
          </button>
          ${canCancel ? `
            <button class="np-recent-batch-cancel" type="button" data-production-cancel-batch="${escapeHtml(batch.productionBatchId)}" data-batch-number="${escapeHtml(batch.batchNumber)}" data-batch-status="${escapeHtml(batch.status)}" aria-label="Cancel batch ${escapeHtml(batch.batchNumber)}" title="Cancel batch">
              <i class="bi bi-x-lg"></i>
            </button>
          ` : ""}
        </div>
      `;
    }).join("");

    list.querySelectorAll("[data-production-recent-batch]").forEach((button) => {
      button.addEventListener("click", () => {
        loadBatch(button.dataset.productionRecentBatch);
      });
    });

    list.querySelectorAll("[data-production-cancel-batch]").forEach((button) => {
      button.addEventListener("click", () => {
        cancelOpenBatch(button.dataset.productionCancelBatch, button.dataset.batchNumber, button.dataset.batchStatus);
      });
    });
  }

  async function loadOpenBatches() {
    try {
      openBatches = await window.NextPulse.api.get("/production/batches/open");
      renderOpenBatchOptions();
    } catch (exception) {
      openBatches = [];
      renderOpenBatchOptions();
      showMessage(exception.message || "Unable to load open production batches.", "error");
    }
  }

  async function loadRecentBatches() {
    try {
      recentBatches = await window.NextPulse.api.get("/production/batches/recent");
      renderRecentBatches();
    } catch (exception) {
      recentBatches = [];
      renderRecentBatches();
      showMessage(exception.message || "Unable to load open production batches.", "error");
    }
  }

  async function loadBatch(productionBatchId) {
    if (!productionBatchId) {
      return;
    }

    try {
      currentBatch = await window.NextPulse.api.get(`/production/batches/${productionBatchId}`);
      renderBatch();
      renderRecentBatches();
      showMessage("");
    } catch (exception) {
      showMessage(exception.message || "Unable to load production batch.", "error");
    }
  }

  async function cancelOpenBatch(productionBatchId, batchNumber, status) {
    if (!productionBatchId) {
      return;
    }

    const isInProgress = status === "IN_PROGRESS";
    const confirmed = await window.NextPulse.ui.confirmAction({
      type: "danger",
      kicker: isInProgress ? "Production warning" : "Delete draft",
      title: isInProgress ? "Cancel this active batch?" : "Delete this draft batch?",
      message: `${batchNumber || "This batch"} will be removed from active production work.`,
      detail: isInProgress
        ? "Posted inventory movements will remain in inventory and will not be reversed."
        : "The draft has not posted inventory movements and can be safely removed.",
      confirmLabel: isInProgress ? "Cancel active batch" : "Delete draft",
      cancelLabel: "Keep batch"
    });

    if (!confirmed) {
      return;
    }

    try {
      await window.NextPulse.api.post(`/production/batches/${productionBatchId}/cancel`, {});

      if (currentBatch?.batch?.productionBatchId === productionBatchId) {
        currentBatch = null;
        renderBatch();
      }

      await Promise.allSettled([
        loadOpenBatches(),
        loadRecentBatches()
      ]);
      renderOpenBatchOptions();
      showMessage("Production batch cancelled.", "success");
    } catch (exception) {
      showMessageAtTop(exception.message || "Unable to cancel production batch.", "error");
    }
  }

  function updatePreview() {
    const recipe = selectedRecipe();
    const quantity = Number(document.getElementById("productionQuantity")?.value || 0);
    const preview = document.getElementById("productionPreview");

    if (!preview) {
      return;
    }

    if (!recipe) {
      preview.textContent = "Select recipe and quantity to create a draft batch.";
      return;
    }

    if (!quantity || quantity <= 0) {
      preview.textContent = `${recipe.finishedDescription} selected. Enter production quantity.`;
      return;
    }

    preview.textContent = `${formatQuantity(quantity)} ${recipe.outputUnit} ${recipe.finishedDescription} will be planned from ${recipe.recipeName}.`;
  }

  function renderRecipeOptions() {
    const select = document.getElementById("productionRecipe");

    if (!select) {
      return;
    }

    if (recipes.length === 0) {
      select.innerHTML = `<option value="">No active recipes</option>`;
      return;
    }

    select.innerHTML = [
      `<option value="">Select product / recipe</option>`,
      ...recipes.map((recipe) => `
        <option value="${escapeHtml(recipe.recipeVersionId)}">
          ${escapeHtml(recipe.finishedSkuCode)} - ${escapeHtml(recipe.recipeName)}
        </option>
      `)
    ].join("");

    const savedRecipeId = localStorage.getItem(DEFAULT_RECIPE_KEY);
    const defaultRecipe = recipes.find((recipe) => recipe.recipeVersionId === savedRecipeId) || recipes[0];

    if (defaultRecipe) {
      select.value = defaultRecipe.recipeVersionId;
    }
  }

  function stepForStatus(status) {
    if (status === "POSTED" || status === "COMPLETED") {
      return "complete";
    }

    if (status === "IN_PROGRESS") {
      return "progress";
    }

    return "draft";
  }

  function updateWorkflow(status = "DRAFT") {
    const order = ["draft", "materials", "progress", "complete"];
    const activeStep = stepForStatus(status);
    const activeIndex = order.indexOf(activeStep);

    document.querySelectorAll("[data-production-step]").forEach((step) => {
      const index = order.indexOf(step.dataset.productionStep);
      step.classList.toggle("is-active", index === activeIndex);
      step.classList.toggle("is-complete", index >= 0 && index < activeIndex);
    });
  }

  function syncCompletionFields(batch) {
    const fields = document.getElementById("productionCompletionFields");
    const goodInput = document.getElementById("productionGoodQuantity");
    const wasteInput = document.getElementById("productionWasteQuantity");
    const showFields = batch?.status === "IN_PROGRESS";

    if (fields) {
      fields.hidden = !showFields;
    }

    if (!showFields || !goodInput || !wasteInput) {
      return;
    }

    if (goodInput.dataset.batchId !== batch.productionBatchId) {
      goodInput.value = Number(batch.actualOutputQuantity || batch.plannedOutputQuantity || 0);
      wasteInput.value = 0;
      goodInput.dataset.batchId = batch.productionBatchId;
      wasteInput.dataset.batchId = batch.productionBatchId;
    }
  }

  function renderBatch() {
    const title = document.getElementById("productionBatchTitle");
    const copy = document.getElementById("productionBatchCopy");
    const planned = document.getElementById("productionPlannedOutput");
    const materialCount = document.getElementById("productionMaterialCount");
    const prepareButton = document.getElementById("prepareProductionMaterials");
    const completeButton = document.getElementById("completeProductionBatch");
    const completionFields = document.getElementById("productionCompletionFields");
    const body = document.getElementById("productionMaterialBody");
    const mobileList = document.getElementById("productionMobileList");
    const recipeInput = document.getElementById("productionRecipe");
    const quantityInput = document.getElementById("productionQuantity");
    const dateInput = document.getElementById("productionDate");
    const contentTitle = document.getElementById("productionContentTitle");
    const contentStatus = document.getElementById("productionContentStatus");
    const contentLock = document.getElementById("productionContentLock");
    const createButton = document.querySelector("#productionForm button[type='submit']");

    if (!currentBatch) {
      [recipeInput, quantityInput, dateInput].forEach((input) => { if (input) input.disabled = false; });
      if (contentTitle) contentTitle.textContent = "What are you making?";
      if (contentStatus) {
        contentStatus.textContent = "New batch";
        contentStatus.className = "np-batch-status is-draft";
      }
      if (contentLock) contentLock.hidden = true;
      if (createButton) createButton.disabled = false;
      window.NextPulse.ui.setPageContext("", "production");
      if (title) {
        title.textContent = "No batch yet";
      }
      if (copy) {
        copy.textContent = "Create a draft batch to calculate material requirements from the active recipe.";
      }
      if (planned) {
        planned.textContent = "0";
      }
      if (materialCount) {
        materialCount.textContent = "0";
      }
      if (prepareButton) {
        prepareButton.disabled = true;
      }
      if (completeButton) {
        completeButton.disabled = true;
      }
      if (completionFields) {
        completionFields.hidden = true;
      }
      if (body) {
        body.innerHTML = `<tr><td colspan="5" class="np-empty-cell">Material requirements will appear here.</td></tr>`;
      }
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">Material requirements will appear here.</div>`;
      updateWorkflow("DRAFT");
      renderRecentBatches();
      return;
    }

    const batch = currentBatch.batch;
    const materials = currentBatch.materials || [];
    const suggestedLines = materials.filter((line) => Number(line.suggestedIssueContainerQuantity || 0) > 0);

    const matchingRecipe = recipes.find((recipe) => recipe.recipeCode === batch.recipeCode || recipe.recipeName === batch.recipeName);
    if (recipeInput && matchingRecipe) recipeInput.value = matchingRecipe.recipeVersionId;
    if (quantityInput) quantityInput.value = Number(batch.plannedOutputQuantity || 0);
    if (dateInput && batch.productionDate) dateInput.value = batch.productionDate;
    [recipeInput, quantityInput, dateInput].forEach((input) => { if (input) input.disabled = true; });
    if (contentTitle) contentTitle.textContent = batch.finishedDescription || batch.recipeName || "Production batch";
    if (contentStatus) {
      contentStatus.textContent = statusLabel(batch.status);
      contentStatus.className = `np-batch-status is-${statusClass(batch.status)}`;
    }
    if (contentLock) contentLock.hidden = false;
    if (createButton) createButton.disabled = true;
    window.NextPulse.ui.setPageContext(batch.batchNumber || "Current batch", "production");

    if (title) {
      title.textContent = batch.batchNumber || "Draft batch";
    }
    if (copy) {
      copy.textContent = `${batch.finishedDescription} · Lot ${batch.lotNumber} · ${batch.status}`;
    }
    if (planned) {
      planned.textContent = formatQuantity(batch.plannedOutputQuantity);
    }
    if (materialCount) {
      materialCount.textContent = String(materials.length);
    }
    if (prepareButton) {
      prepareButton.disabled = batch.status !== "DRAFT";
    }
    if (completeButton) {
      completeButton.disabled = batch.status !== "IN_PROGRESS";
    }

    updateWorkflow(batch.status);
    syncCompletionFields(batch);

    if (!body) {
      return;
    }

    if (materials.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="np-empty-cell">No materials found for this recipe.</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">No materials found for this recipe.</div>`;
      return;
    }

    body.innerHTML = materials.map((line) => {
      const factoryContainerQty = Number(line.factoryOnHandContainerQuantity || 0);
      const factoryBaseQty = Number(line.factoryOnHandBaseQuantity || 0);
      const productionBaseQty = Number(line.productionAreaOpeningBaseQuantity || 0);
      const basePerContainer = numericValue(line.expectedBaseQuantityPerContainer);
      const requiredBaseQty = numericValue(line.plannedBaseQuantityWithWaste);
      const productionContainerQty = basePerContainer > 0 ? productionBaseQty / basePerContainer : 0;
      const plannedContainerQty = basePerContainer > 0
        ? requiredBaseQty / basePerContainer
        : requiredBaseQty;
      const suggestedTransferQty = suggestedTransferPackageQuantity(requiredBaseQty, productionBaseQty, basePerContainer);
      const consumedContainerQty = Number(line.actualConsumedBaseQuantity || 0) > 0 && basePerContainer > 0
        ? Number(line.actualConsumedBaseQuantity || 0) / basePerContainer
        : plannedContainerQty;
      const isDraft = batch.status === "DRAFT";
      const isInProgress = batch.status === "IN_PROGRESS";
      const isPosted = batch.status === "POSTED" || batch.status === "COMPLETED";
      const movementValue = isInProgress || isPosted ? consumedContainerQty : suggestedTransferQty;
      const movementInputValue = isInProgress || isPosted
        ? formatInputQuantity(movementValue)
        : formatPackageInputQuantity(movementValue);
      const movementAttribute = isInProgress
        ? `data-production-consume="${escapeHtml(line.batchMaterialId)}"`
        : (isDraft ? `data-production-transfer="${escapeHtml(line.batchMaterialId)}"` : "");
      const movementDisabled = isDraft || isInProgress ? "" : "disabled";
      const movementHint = isPosted
        ? `${formatQuantity(line.actualConsumedBaseQuantity)} ${escapeHtml(line.baseUnit)} consumed`
        : (isInProgress
        ? `${formatQuantity(line.plannedBaseQuantityWithWaste)} ${escapeHtml(line.baseUnit)} planned`
        : `${formatQuantity(line.plannedBaseQuantityWithWaste)} ${escapeHtml(line.baseUnit)} needed`);
      return `
        <tr>
          <td>
            <div class="np-item-main">
              <strong>${escapeHtml(line.description)}</strong>
              <span>${escapeHtml(line.skuCode)}</span>
            </div>
          </td>
          <td class="text-end">
            <span class="np-stock-cell np-production-stock" data-production-required-cell>
              ${renderPackageQuantityVisual(plannedContainerQty, line.containerUnit)}
              <small>${formatQuantity(requiredBaseQty)} ${escapeHtml(line.baseUnit)}</small>
            </span>
          </td>
          <td class="text-end">
            <span class="np-stock-cell np-production-stock" data-production-factory-cell>
              ${renderPackageQuantityVisual(factoryContainerQty, line.containerUnit)}
              <small>${formatQuantity(factoryBaseQty)} ${escapeHtml(line.baseUnit)}</small>
            </span>
          </td>
          <td class="text-end">
            <span class="np-stock-cell np-production-stock" data-production-area-cell>
              ${renderPackageQuantityVisual(productionContainerQty, line.containerUnit)}
              <small>${formatQuantity(productionBaseQty)} ${escapeHtml(line.baseUnit)}</small>
            </span>
          </td>
          <td class="text-end">
            <label class="np-inline-number np-transfer-control">
              <input
                type="number"
                min="0"
                step="${isDraft ? "1" : "0.01"}"
                inputmode="${isDraft ? "numeric" : "decimal"}"
                value="${movementInputValue}"
                ${movementAttribute}
                data-base-per-container="${basePerContainer}"
                data-planned-base="${requiredBaseQty}"
                data-factory-on-hand-base="${factoryBaseQty}"
                data-production-on-hand-base="${productionBaseQty}"
                ${movementDisabled}
              >
              <span>${escapeHtml(line.containerUnit)}</span>
            </label>
            <small class="np-transfer-hint">${movementHint}</small>
          </td>
          <td class="text-center">
            <span class="np-status-icon" data-production-stock-status title="Checking stock" aria-label="Checking stock">
              <i class="bi bi-circle"></i>
            </span>
          </td>
        </tr>
      `;
    }).join("");

    if (mobileList) mobileList.innerHTML = materials.map((line) => {
      const factoryBaseQty = Number(line.factoryOnHandBaseQuantity || 0);
      const productionBaseQty = Number(line.productionAreaOpeningBaseQuantity || 0);
      const basePerContainer = numericValue(line.expectedBaseQuantityPerContainer);
      const requiredBaseQty = numericValue(line.plannedBaseQuantityWithWaste);
      const requiredContainers = basePerContainer > 0 ? requiredBaseQty / basePerContainer : requiredBaseQty;
      const factoryContainers = Number(line.factoryOnHandContainerQuantity || 0);
      const productionContainers = basePerContainer > 0 ? productionBaseQty / basePerContainer : 0;
      const suggested = suggestedTransferPackageQuantity(requiredBaseQty, productionBaseQty, basePerContainer);
      const consumed = Number(line.actualConsumedBaseQuantity || 0) > 0 && basePerContainer > 0 ? Number(line.actualConsumedBaseQuantity) / basePerContainer : requiredContainers;
      const isDraft = batch.status === "DRAFT";
      const isInProgress = batch.status === "IN_PROGRESS";
      const value = isInProgress ? formatInputQuantity(consumed) : formatPackageInputQuantity(suggested);
      const attribute = isInProgress ? `data-production-consume="${escapeHtml(line.batchMaterialId)}"` : (isDraft ? `data-production-transfer="${escapeHtml(line.batchMaterialId)}"` : "");
      return `<article class="np-mobile-record-card" data-production-material>
        <div class="np-mobile-record-head"><div class="np-mobile-record-title"><strong>${escapeHtml(line.description)}</strong><span>${escapeHtml(line.skuCode)}</span></div><span class="np-order-status">${escapeHtml(batch.status)}</span></div>
        <div class="np-mobile-record-grid">
          <div class="np-mobile-record-metric"><span>Required</span><strong>${formatQuantity(requiredContainers)} ${escapeHtml(line.containerUnit)}</strong></div>
          <div class="np-mobile-record-metric"><span>Factory stock</span><strong>${formatQuantity(factoryContainers)} ${escapeHtml(line.containerUnit)}</strong></div>
          <div class="np-mobile-record-metric"><span>Production area</span><strong>${formatQuantity(productionContainers)} ${escapeHtml(line.containerUnit)}</strong></div>
          <div class="np-mobile-record-metric"><span>Base needed</span><strong>${formatQuantity(requiredBaseQty)} ${escapeHtml(line.baseUnit)}</strong></div>
        </div>
        <label class="np-field"><span>${isInProgress ? "Consumed quantity" : "Transfer quantity"}</span><span class="np-inline-number"><input type="number" min="0" step="${isDraft ? "1" : "0.01"}" value="${value}" ${attribute} data-base-per-container="${basePerContainer}" data-planned-base="${requiredBaseQty}" data-factory-on-hand-base="${factoryBaseQty}" data-production-on-hand-base="${productionBaseQty}" ${isDraft || isInProgress ? "" : "disabled"}><span>${escapeHtml(line.containerUnit)}</span></span></label>
      </article>`;
    }).join("");

    document.querySelectorAll("[data-production-transfer]").forEach((input) => {
      input.addEventListener("input", updateTransferWarnings);
      input.addEventListener("keydown", (event) => {
        if ([".", ",", "e", "E", "+", "-"].includes(event.key)) {
          event.preventDefault();
        }
      });
      input.addEventListener("change", () => {
        normalizePackageInput(input);
        updateTransferWarnings();
      });
    });
    document.querySelectorAll("[data-production-consume]").forEach((input) => {
      input.addEventListener("input", updateConsumptionWarnings);
    });

    if (batch.status === "IN_PROGRESS") {
      updateConsumptionWarnings();
    } else {
      updateTransferWarnings();
    }

    if (suggestedLines.length === 0) {
      showMessage("Production area already has enough planned materials for this batch.", "success");
    }

    renderRecentBatches();
  }

  async function loadRecipes() {
    if (hasLoaded) {
      return;
    }

    try {
      recipes = await window.NextPulse.api.get("/production/recipes");
      hasLoaded = true;
      renderRecipeOptions();
      updatePreview();
      if (currentBatch) renderBatch();
    } catch (exception) {
      const select = document.getElementById("productionRecipe");
      if (select) {
        select.innerHTML = `<option value="">Unable to load recipes</option>`;
      }
      showMessage(exception.message || "Unable to load production recipes.", "error");
    }
  }

  async function createBatch(event) {
    event.preventDefault();
    showMessage("");

    const recipe = selectedRecipe();
    const quantity = Number(document.getElementById("productionQuantity")?.value || 0);

    if (!recipe) {
      showMessage("Select a product / recipe.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("productionRecipe"), "Choose the cookie or recipe for this batch.");
      return;
    }

    if (!quantity || quantity <= 0) {
      showMessage("Production quantity must be greater than zero.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("productionQuantity"), "Enter at least one cookie.");
      return;
    }

    if (!document.getElementById("productionDate")?.value) {
      showMessage("Production date is required.", "error");
      window.NextPulse.ui.focusFieldError(document.getElementById("productionDate"), "Choose the production date.");
      return;
    }

    const payload = {
      recipeVersionId: recipe.recipeVersionId,
      plannedOutputQuantity: quantity,
      productionDate: document.getElementById("productionDate")?.value || today(),
      notes: document.getElementById("productionNotes")?.value.trim() || null
    };

    localStorage.setItem(DEFAULT_RECIPE_KEY, recipe.recipeVersionId);

    try {
      currentBatch = await window.NextPulse.api.post("/production/batches", payload);
      await Promise.allSettled([
        loadOpenBatches(),
        loadRecentBatches()
      ]);
      renderBatch();
      renderOpenBatchOptions();
      showMessage("Draft production batch created.", "success");
    } catch (exception) {
      showMessage(exception.message || "Unable to create production batch.", "error");
    }
  }

  async function prepareMaterials() {
    if (!currentBatch?.batch?.productionBatchId) {
      return;
    }

    const button = document.getElementById("prepareProductionMaterials");
    const originalText = button?.innerHTML;

    if (hasInsufficientTransfer()) {
      showMessageAtTop("Stock is not enough for one or more material lines. Check Factory and Production Area stock before starting.", "error");
      updateTransferWarnings();
      return;
    }

    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Preparing`;
    }

    try {
      const response = await window.NextPulse.api.post(`/production/batches/${currentBatch.batch.productionBatchId}/prepare-materials`, buildPreparePayload());
      currentBatch = await window.NextPulse.api.get(`/production/batches/${currentBatch.batch.productionBatchId}`);
      await Promise.allSettled([
        loadOpenBatches(),
        loadRecentBatches()
      ]);
      renderBatch();
      renderOpenBatchOptions();
      showMessage(
        response.transactionNumber
          ? `Materials prepared. Transfer ${response.transactionNumber} posted.`
          : "Materials already available in production area.",
        "success"
      );
    } catch (exception) {
      showMessageAtTop(exception.message || "Unable to prepare materials.", "error");
      renderBatch();
    } finally {
      if (button) {
        button.innerHTML = originalText;
        button.disabled = currentBatch?.batch?.status !== "DRAFT";
      }
    }
  }

  async function completeProduction() {
    if (!currentBatch?.batch?.productionBatchId) {
      return;
    }

    const button = document.getElementById("completeProductionBatch");
    const originalText = button?.innerHTML;

    if (hasInvalidCompletion()) {
      showMessageAtTop("Check good cookies and consumed material quantities before completing production.", "error");
      updateConsumptionWarnings();
      return;
    }

    if (button) {
      button.disabled = true;
      button.innerHTML = `<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Completing`;
    }

    try {
      const response = await window.NextPulse.api.post(`/production/batches/${currentBatch.batch.productionBatchId}/complete`, buildCompletePayload());
      currentBatch = await window.NextPulse.api.get(`/production/batches/${currentBatch.batch.productionBatchId}`);
      await Promise.allSettled([
        loadOpenBatches(),
        loadRecentBatches(),
        window.NextPulse.inventory?.refresh?.()
      ]);
      renderBatch();
      renderOpenBatchOptions();
      showMessage(
        `Production completed. Consumption ${response.consumptionTransactionNumber || "not needed"} and output ${response.outputTransactionNumber} posted.`,
        "success"
      );
    } catch (exception) {
      showMessageAtTop(exception.message || "Unable to complete production.", "error");
      renderBatch();
    } finally {
      if (button) {
        button.innerHTML = originalText;
        button.disabled = currentBatch?.batch?.status !== "IN_PROGRESS";
      }
    }
  }

  function reset() {
    currentBatch = null;
    const savedRecipeId = localStorage.getItem(DEFAULT_RECIPE_KEY);
    const recipeSelect = document.getElementById("productionRecipe");
    if (recipeSelect) {
      recipeSelect.value = recipes.some((recipe) => recipe.recipeVersionId === savedRecipeId)
        ? savedRecipeId
        : (recipes[0]?.recipeVersionId || "");
    }
    document.getElementById("productionQuantity").value = "";
    document.getElementById("productionDate").value = today();
    document.getElementById("productionNotes").value = "";
    showMessage("");
    updatePreview();
    renderBatch();
    renderOpenBatchOptions();
  }

  function buildPreparePayload() {
    const lines = Array.from(document.querySelectorAll("[data-production-transfer]"))
      .filter((input) => input.offsetParent !== null)
      .map((input) => ({
        batchMaterialId: input.dataset.productionTransfer,
        transferContainerQuantity: packageInputQuantity(input)
      }));

    return {
      lines
    };
  }

  function buildCompletePayload() {
    const lines = Array.from(document.querySelectorAll("[data-production-consume]"))
      .filter((input) => input.offsetParent !== null)
      .map((input) => ({
        batchMaterialId: input.dataset.productionConsume,
        consumedContainerQuantity: Number(input.value || 0)
      }));

    return {
      actualOutputQuantity: Number(document.getElementById("productionGoodQuantity")?.value || 0),
      finishedGoodWasteQuantity: Number(document.getElementById("productionWasteQuantity")?.value || 0),
      lines
    };
  }

  function initDefaults() {
    const date = document.getElementById("productionDate");
    if (date && !date.value) {
      date.value = today();
    }
  }

  function init() {
    initDefaults();
    renderBatch();
    document.getElementById("productionRecipe")?.addEventListener("change", () => {
      const recipe = selectedRecipe();
      if (recipe) {
        localStorage.setItem(DEFAULT_RECIPE_KEY, recipe.recipeVersionId);
      }
      updatePreview();
    });
    document.getElementById("productionQuantity")?.addEventListener("input", updatePreview);
    document.querySelectorAll("[data-production-quantity-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById("productionQuantity");
        if (!input || input.disabled) return;
        const step = Number(button.dataset.productionQuantityStep || 0);
        input.value = String(Math.max(1, Math.trunc(numericValue(input.value)) + step));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
        input.select();
      });
    });
    document.getElementById("productionGoodQuantity")?.addEventListener("input", () => showMessage(""));
    document.getElementById("productionWasteQuantity")?.addEventListener("input", () => showMessage(""));
    document.getElementById("productionOpenBatch")?.addEventListener("change", (event) => {
      loadBatch(event.target.value);
    });
    document.getElementById("productionForm")?.addEventListener("submit", createBatch);
    document.getElementById("prepareProductionMaterials")?.addEventListener("click", prepareMaterials);
    document.getElementById("completeProductionBatch")?.addEventListener("click", completeProduction);
    document.getElementById("resetProduction")?.addEventListener("click", reset);

    document.addEventListener("nextpulse:page-change", (event) => {
      if (event.detail?.page === "production") {
        loadRecipes();
        loadOpenBatches();
        loadRecentBatches();
        window.setTimeout(() => {
          document.getElementById("productionRecipe")?.focus();
        }, 0);
      }
    });
  }

  return {
    init,
    loadRecipes,
    loadRecentBatches
  };
})();

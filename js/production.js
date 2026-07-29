window.NextPulse = window.NextPulse || {};

window.NextPulse.production = (() => {
  const DEFAULT_RECIPE_KEY = "nextpulse.production.defaultRecipeVersionId";
  let recipes = [];
  let openBatches = [];
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

    const isInteger = Math.abs(number - Math.round(number)) < 0.000001;

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: isInteger ? 0 : 2,
      maximumFractionDigits: isInteger ? 0 : 2
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

  function isDiscreteUnit(unit) {
    return ["ADET", "AD", "RULO", "KOLI", "KOLİ", "BALYA", "TORBA", "PAKET", "PALET"]
      .includes(String(unit || "").trim().toUpperCase());
  }

  function neededBaseQuantity(value, unit) {
    const quantity = Math.max(numericValue(value), 0);
    return isDiscreteUnit(unit)
      ? Math.ceil(quantity - 0.000001)
      : quantity;
  }

  function formatNeededBaseQuantity(value, unit) {
    return formatQuantity(neededBaseQuantity(value, unit));
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

  function formatPackageAndRemainder(baseQuantity, basePerContainer, containerUnit, baseUnit) {
    const base = neededBaseQuantity(baseQuantity, baseUnit);
    const perContainer = numericValue(basePerContainer);

    if (perContainer <= 0 || !containerUnit || containerUnit === baseUnit) {
      return `${formatQuantity(base)} ${escapeHtml(baseUnit)}`;
    }

    const fullContainers = Math.floor(base / perContainer + 0.000001);
    const remainder = Math.max(base - fullContainers * perContainer, 0);

    if (remainder < 0.000001) {
      return `${formatQuantity(fullContainers)} ${escapeHtml(containerUnit)}`;
    }

    if (fullContainers === 0) {
      return `${formatQuantity(remainder)} ${escapeHtml(baseUnit)} <small>(&lt;1 ${escapeHtml(containerUnit)})</small>`;
    }

    return `${formatQuantity(fullContainers)} ${escapeHtml(containerUnit)} + ${formatQuantity(remainder)} ${escapeHtml(baseUnit)}`;
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
      .some((input) => isFactoryTransferShort(input));
  }

  function isConsumptionTooHigh(input) {
    return containerBaseQuantity(input) > numericValue(input.dataset.productionOnHandBase) + 0.000001;
  }

  function hasInvalidCompletion() {
    const goodQuantity = numericValue(document.getElementById("productionGoodQuantity")?.value);
    const wasteQuantity = numericValue(document.getElementById("productionWasteQuantity")?.value);

    return goodQuantity <= 0
      || wasteQuantity < 0
      || Array.from(document.querySelectorAll("[data-production-consume]"))
        .filter((input) => input.offsetParent !== null)
        .some((input) => numericValue(input.value) < 0 || isConsumptionTooHigh(input));
  }

  function stockStatusMessage(input) {
    if (isFactoryTransferShort(input)) {
      return "Factory stock is not enough for the selected transfer quantity.";
    }

    if (isTransferTooLow(input)) {
      return "Partial preparation. The remaining quantity can be prepared later.";
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
      const partialTransfer = transferLow || totalShort;

      row?.classList.toggle("is-stock-short", transferShort);
      row?.classList.toggle("is-partial-transfer", !transferShort && partialTransfer);
      input.classList.toggle("is-danger", transferShort);
      factoryCell?.classList.toggle("is-danger", transferShort);
      productionCell?.classList.remove("is-danger");
      requiredCell?.classList.remove("is-danger");

      if (statusIcon) {
        statusIcon.classList.toggle("is-danger", transferShort);
        statusIcon.classList.toggle("is-partial", !transferShort && partialTransfer);
        statusIcon.classList.toggle("is-no-need", transferNotNeeded && !transferShort && !partialTransfer);
        statusIcon.classList.toggle("is-ready", !transferNotNeeded && !transferShort && !partialTransfer);
        statusIcon.title = message;
        statusIcon.setAttribute("aria-label", message);
        statusIcon.innerHTML = transferShort
          ? `<i class="bi bi-exclamation-triangle-fill"></i>`
          : (partialTransfer
            ? `<i class="bi bi-clock-history"></i>`
          : (transferNotNeeded
            ? `<i class="bi bi-dash-circle-fill"></i>`
            : `<i class="bi bi-check-circle-fill"></i>`));
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

  async function loadBatch(productionBatchId) {
    if (!productionBatchId) {
      return;
    }

    try {
      currentBatch = await window.NextPulse.api.get(`/production/batches/${productionBatchId}`);
      renderBatch();
      showMessage("");
    } catch (exception) {
      showMessage(exception.message || "Unable to load production batch.", "error");
    }
  }

  async function cancelOpenBatch(productionBatchId, batchNumber, status) {
    if (!productionBatchId) {
      return;
    }

    const confirmed = await window.NextPulse.ui.confirmAction({
      type: "danger",
      kicker: "Delete draft",
      title: "Delete this draft batch?",
      message: `${batchNumber || "This batch"} will be removed from active production work.`,
      detail: "Any already-posted inventory movements remain in the inventory ledger.",
      confirmLabel: "Delete draft",
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

      await loadOpenBatches();
      renderOpenBatchOptions();
      showMessage("Draft batch deleted.", "success");
    } catch (exception) {
      showMessageAtTop(exception.message || "Unable to delete draft batch.", "error");
    }
  }

  async function revertCurrentBatchToDraft() {
    const batch = currentBatch?.batch;
    if (!batch?.productionBatchId || batch.status !== "IN_PROGRESS") return;

    const confirmed = await window.NextPulse.ui.confirmAction({
      type: "warning",
      kicker: "Production correction",
      title: "Return this batch to Draft?",
      message: `${batch.batchNumber} will become editable for additional material preparation.`,
      detail: "Existing inventory movements remain posted and traceable.",
      confirmLabel: "Return to Draft",
      cancelLabel: "Keep In Progress"
    });

    if (!confirmed) return;

    try {
      await window.NextPulse.api.post(`/production/batches/${batch.productionBatchId}/reopen`, {});
      currentBatch = await window.NextPulse.api.get(`/production/batches/${batch.productionBatchId}`);
      await loadOpenBatches();
      renderBatch();
      renderOpenBatchOptions();
      showMessage("Batch returned to Draft.", "success");
    } catch (exception) {
      showMessageAtTop(exception.message || "Unable to return batch to Draft.", "error");
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
      wasteInput.value = 0;
      goodInput.dataset.batchId = batch.productionBatchId;
      wasteInput.dataset.batchId = batch.productionBatchId;
    }

    syncGoodOutputFromWaste();
  }

  function syncGoodOutputFromWaste() {
    const goodInput = document.getElementById("productionGoodQuantity");
    const wasteInput = document.getElementById("productionWasteQuantity");
    const preview = document.getElementById("productionYieldPreview");
    const planned = numericValue(currentBatch?.batch?.plannedOutputQuantity);
    const waste = numericValue(wasteInput?.value);
    const good = Math.max(planned - waste, 0);
    const unit = currentBatch?.batch?.outputUnit || "ADET";

    if (goodInput) {
      goodInput.value = String(good);
    }

    if (preview) {
      preview.textContent = `${formatQuantity(planned)} planned − ${formatQuantity(waste)} Fire/Zayi = ${formatQuantity(good)} good ${unit}.`;
      preview.classList.toggle("is-error", waste >= planned && planned > 0);
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
    const batchActions = document.getElementById("productionCurrentBatchActions");
    const deleteDraftButton = document.getElementById("deleteProductionDraft");
    const revertDraftButton = document.getElementById("revertProductionDraft");
    const planLabel = document.getElementById("productionPlanLabel");
    const planTitle = document.getElementById("productionPlanTitle");

    if (!currentBatch) {
      if (planLabel) planLabel.textContent = "New Batch";
      if (planTitle) planTitle.textContent = "Plan production";
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
      if (batchActions) batchActions.hidden = true;
      if (body) {
        body.innerHTML = `<tr><td colspan="5" class="np-empty-cell">Material requirements will appear here.</td></tr>`;
      }
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">Material requirements will appear here.</div>`;
      updateWorkflow("DRAFT");
      return;
    }

    const batch = currentBatch.batch;
    if (planLabel) planLabel.textContent = "Selected Batch";
    if (planTitle) planTitle.textContent = "Continue production";
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
    if (batchActions) batchActions.hidden = !["DRAFT", "IN_PROGRESS"].includes(batch.status);
    if (deleteDraftButton) deleteDraftButton.hidden = batch.status !== "DRAFT";
    if (revertDraftButton) revertDraftButton.hidden = batch.status !== "IN_PROGRESS";

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
        ? `${formatNeededBaseQuantity(line.actualConsumedBaseQuantity, line.baseUnit)} ${escapeHtml(line.baseUnit)} consumed`
        : (isInProgress
        ? `${formatNeededBaseQuantity(line.plannedBaseQuantityWithWaste, line.baseUnit)} ${escapeHtml(line.baseUnit)} planned`
        : `${formatNeededBaseQuantity(line.plannedBaseQuantityWithWaste, line.baseUnit)} ${escapeHtml(line.baseUnit)} needed`);
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
              <small>${formatNeededBaseQuantity(requiredBaseQty, line.baseUnit)} ${escapeHtml(line.baseUnit)}</small>
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
          <div class="np-mobile-record-metric"><span>Base needed</span><strong>${formatPackageAndRemainder(requiredBaseQty, basePerContainer, line.containerUnit, line.baseUnit)}</strong><small>${formatNeededBaseQuantity(requiredBaseQty, line.baseUnit)} ${escapeHtml(line.baseUnit)} total</small></div>
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
      await loadOpenBatches();
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
      showMessageAtTop("A transfer quantity is greater than the available Factory stock.", "error");
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
      await loadOpenBatches();
      renderBatch();
      renderOpenBatchOptions();
      showMessage(
        response.transactionNumber
          ? (response.status === "DRAFT"
            ? `Partial materials prepared. Transfer ${response.transactionNumber} posted; the batch remains Draft until staging is complete.`
            : `Materials prepared. Transfer ${response.transactionNumber} posted.`)
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
      await Promise.allSettled([
        loadOpenBatches(),
        window.NextPulse.inventory?.refresh?.()
      ]);
      currentBatch = null;
      const recipeSelect = document.getElementById("productionRecipe");
      const savedRecipeId = localStorage.getItem(DEFAULT_RECIPE_KEY);
      if (recipeSelect) {
        recipeSelect.value = recipes.some((recipe) => recipe.recipeVersionId === savedRecipeId)
          ? savedRecipeId
          : (recipes[0]?.recipeVersionId || "");
      }
      document.getElementById("productionQuantity").value = "";
      document.getElementById("productionDate").value = today();
      document.getElementById("productionNotes").value = "";
      document.getElementById("productionGoodQuantity").value = "";
      document.getElementById("productionWasteQuantity").value = "0";
      updatePreview();
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
    document.getElementById("productionWasteQuantity")?.addEventListener("input", () => {
      syncGoodOutputFromWaste();
      showMessage("");
    });
    document.getElementById("productionOpenBatch")?.addEventListener("change", (event) => {
      if (event.target.value) {
        loadBatch(event.target.value);
      } else {
        reset();
      }
    });
    document.getElementById("productionForm")?.addEventListener("submit", createBatch);
    document.getElementById("prepareProductionMaterials")?.addEventListener("click", prepareMaterials);
    document.getElementById("completeProductionBatch")?.addEventListener("click", completeProduction);
    document.getElementById("resetProduction")?.addEventListener("click", reset);
    document.getElementById("deleteProductionDraft")?.addEventListener("click", () => {
      const batch = currentBatch?.batch;
      if (batch?.status === "DRAFT") {
        cancelOpenBatch(batch.productionBatchId, batch.batchNumber, batch.status);
      }
    });
    document.getElementById("revertProductionDraft")?.addEventListener("click", revertCurrentBatchToDraft);

    document.addEventListener("nextpulse:page-change", (event) => {
      if (event.detail?.page === "production") {
        loadRecipes();
        loadOpenBatches();
        window.setTimeout(() => {
          document.getElementById("productionOpenBatch")?.focus();
        }, 0);
      }
    });
  }

  return {
    init,
    loadRecipes
  };
})();

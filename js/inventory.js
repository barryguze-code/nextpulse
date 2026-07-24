window.NextPulse = window.NextPulse || {};

window.NextPulse.inventory = (() => {
  const COLUMN_STORAGE_KEY = "nextpulse.inventory.visibleColumns";
  const DEFAULT_COLUMNS = ["item", "category", "location", "packageStock", "baseStock", "actions"];
  const LOCKED_COLUMNS = ["item", "actions"];
  const COLUMNS = [
    { key: "item", label: "Item" },
    { key: "category", label: "Category" },
    { key: "location", label: "Locations" },
    { key: "packageStock", label: "Package Stock" },
    { key: "baseStock", label: "Base Stock" },
    { key: "actions", label: "Actions" }
  ];

  let items = [];
  let openProductionBatches = [];
  let hasLoaded = false;
  let batchesLoaded = false;
  let selectedItem = null;

  function formatQuantity(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number);
  }

  function isWholeUnit(unit) {
    return ["ADET", "AD", "PALET"].includes(String(unit || "").trim().toUpperCase());
  }

  function formatQuantityForUnit(value, unit) {
    const number = Number(value || 0);
    const digits = isWholeUnit(unit) ? 0 : 2;

    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(number);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function getUnitsPerPack(item) {
    return Number(item.unitsPerPack || item.unitsPerPackage || item.expectedBaseQuantityPerContainer || item.packSize || 1) || 1;
  }

  function getPackUnit(item) {
    return item.packUnit || item.packageUnit || item.containerUnit || item.baseUnit || "";
  }

  function getBaseUnit(item) {
    return item.baseUnit || item.innerUnit || item.unit || "";
  }

  function getInnerUnit(item) {
    return item.innerUnit || item.innerMeasurementUnit || "";
  }

  function getInnerQtyPerPack(item) {
    return Number(item.innerQtyPerPack || item.innerUnitsPerPack || 0);
  }

  function getBaseQtyPerInner(item) {
    return Number(item.baseQtyPerInner || item.baseQuantityPerInner || 0);
  }

  function getPackQuantity(item) {
    const quantity = item.currentPackQuantity || item.currentPackageQuantity || item.currentContainerQuantity || item.calculatedContainerQuantity;

    if (quantity !== undefined && quantity !== null) {
      return Number(quantity);
    }

    return Number(item.currentBaseQuantity || 0) / getUnitsPerPack(item);
  }

  function getOperationalMeasurement(item) {
    const packQuantity = getPackQuantity(item);
    const packUnit = getPackUnit(item);
    const baseUnit = getBaseUnit(item);
    const innerUnit = getInnerUnit(item);
    const innerQtyPerPack = getInnerQtyPerPack(item);
    const baseQuantity = Number(item.currentBaseQuantity || 0);

    if (innerUnit && innerQtyPerPack && innerQtyPerPack !== 1) {
      return {
        quantity: packQuantity * innerQtyPerPack,
        unit: innerUnit
      };
    }

    if (packUnit && packUnit !== baseUnit && getUnitsPerPack(item) !== 1) {
      return {
        quantity: packQuantity,
        unit: packUnit
      };
    }

    return {
      quantity: baseQuantity,
      unit: baseUnit || packUnit
    };
  }

  function getMeasurements(item) {
    const packQuantity = getPackQuantity(item);
    const measurements = [{ quantity: packQuantity, unit: getPackUnit(item) }];
    const innerUnit = getInnerUnit(item);
    const innerQty = getInnerQtyPerPack(item);
    if (innerUnit && innerUnit !== getPackUnit(item) && innerQty > 0) {
      measurements.push({ quantity: packQuantity * innerQty, unit: innerUnit });
    }
    if (getBaseUnit(item) && !measurements.some((entry) => entry.unit === getBaseUnit(item))) {
      measurements.push({ quantity: Number(item.currentBaseQuantity || 0), unit: getBaseUnit(item) });
    }
    return measurements.filter((entry) => entry.unit);
  }

  function renderMeasurements(item) {
    return `<div class="np-inventory-measurements">${getMeasurements(item).map((entry) =>
      `<span><strong>${formatQuantityForUnit(entry.quantity, entry.unit)}</strong> ${escapeHtml(entry.unit)}</span>`
    ).join(`<i class="bi bi-dot"></i>`)}</div>`;
  }

  function getItemKey(item) {
    return item.skuCode || item.itemCode || "";
  }

  function getLocationRows(item) {
    return Array.isArray(item.locationRows) ? item.locationRows : [item];
  }

  function buildGroupedItems() {
    const groupedBySku = new Map();

    items.forEach((row) => {
      const skuCode = row.skuCode || row.itemCode || "";

      if (!skuCode) {
        return;
      }

      if (!groupedBySku.has(skuCode)) {
        groupedBySku.set(skuCode, {
          ...row,
          skuCode,
          locationCode: "",
          locationName: "",
          currentBaseQuantity: 0,
          currentPackageQuantity: 0,
          locationRows: []
        });
      }

      const group = groupedBySku.get(skuCode);
      group.locationRows.push(row);
      group.currentBaseQuantity += Number(row.currentBaseQuantity || 0);
    });

    return Array.from(groupedBySku.values())
      .map((group) => {
        group.locationRows.sort((left, right) => {
          const leftName = left.locationName || left.locationCode || "";
          const rightName = right.locationName || right.locationCode || "";
          return leftName.localeCompare(rightName);
        });
        group.currentPackageQuantity = Number(group.currentBaseQuantity || 0) / getUnitsPerPack(group);
        return group;
      })
      .sort((left, right) => {
        const leftFinished = left.categoryCode === "FINISHED_GOOD" ? 0 : 1;
        const rightFinished = right.categoryCode === "FINISHED_GOOD" ? 0 : 1;
        if (leftFinished !== rightFinished) return leftFinished - rightFinished;
        const descriptionCompare = String(left.description || "").localeCompare(String(right.description || ""));
        return descriptionCompare || String(left.skuCode || "").localeCompare(String(right.skuCode || ""));
      });
  }

  function getImageUrl(item) {
    return item.imageUrl || item.imageURL || item.catalogImageUrl || item.photoUrl || "";
  }

  function getInitials(item) {
    const text = item.description || item.skuCode || "SKU";
    const words = text.split(/[\s/-]+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "SKU";
  }

  function renderThumb(item, sizeClass = "") {
    const imageUrl = getImageUrl(item);
    const label = escapeHtml(item.description || item.skuCode || "Item");

    if (imageUrl) {
      return `<img class="np-item-thumb ${sizeClass}" src="${escapeHtml(imageUrl)}" alt="${label}">`;
    }

    return `<span class="np-item-thumb ${sizeClass}" aria-hidden="true">${escapeHtml(getInitials(item))}</span>`;
  }

  function sameMeasurement(left, right) {
    return left.unit === right.unit && Math.abs(Number(left.quantity) - Number(right.quantity)) < 0.0001;
  }

  function formatMeasurement(measurement) {
    return `${formatQuantityForUnit(measurement.quantity, measurement.unit)} ${measurement.unit}`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function movementDirection(movement) {
    if (movement.fromLocationCode && movement.toLocationCode) {
      return {
        label: "Transfer",
        className: "is-transfer",
        icon: "bi-arrow-left-right",
        location: `${movement.fromLocationName || movement.fromLocationCode} → ${movement.toLocationName || movement.toLocationCode}`
      };
    }

    if (movement.toLocationCode) {
      return {
        label: "Receive",
        className: "is-in",
        icon: "bi-arrow-down-left",
        location: movement.toLocationName || movement.toLocationCode
      };
    }

    if (movement.fromLocationCode) {
      return {
        label: "Use",
        className: "is-out",
        icon: "bi-arrow-up-right",
        location: movement.fromLocationName || movement.fromLocationCode
      };
    }

    return {
      label: "Movement",
      className: "",
      icon: "bi-dot",
      location: ""
    };
  }

  function formatMovementType(value) {
    return String(value || "Movement")
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatMovementBalanceQuantity(containerQuantity, baseQuantity, containerUnit, baseUnit) {
    if (containerQuantity !== undefined && containerQuantity !== null && containerUnit) {
      return `${formatQuantityForUnit(containerQuantity, containerUnit)} ${containerUnit}`;
    }

    return `${formatQuantityForUnit(baseQuantity, baseUnit)} ${baseUnit}`;
  }

  function buildMovementBalanceText(movement, containerUnit, baseUnit) {
    const fromLocation = movement.fromLocationName || movement.fromLocationCode || "";
    const toLocation = movement.toLocationName || movement.toLocationCode || "";
    const fromBalance = movement.fromBalanceBaseQuantityAfter !== undefined && movement.fromBalanceBaseQuantityAfter !== null
      ? `${fromLocation}: ${formatMovementBalanceQuantity(
          movement.fromBalanceContainerQuantityAfter,
          movement.fromBalanceBaseQuantityAfter,
          containerUnit,
          baseUnit
        )}`
      : "";
    const toBalance = movement.toBalanceBaseQuantityAfter !== undefined && movement.toBalanceBaseQuantityAfter !== null
      ? `${toLocation}: ${formatMovementBalanceQuantity(
          movement.toBalanceContainerQuantityAfter,
          movement.toBalanceBaseQuantityAfter,
          containerUnit,
          baseUnit
        )}`
      : "";
    const balances = [fromBalance, toBalance].filter(Boolean);

    if (balances.length === 0) {
      return "";
    }

    return `After: ${balances.join(" · ")}`;
  }

  function buildConversionText(item, quantity = 1) {
    const packUnit = getPackUnit(item);
    const baseUnit = getBaseUnit(item);
    const unitsPerPack = getUnitsPerPack(item);
    const innerUnit = item.innerUnit || "";
    const innerQtyPerPack = Number(item.innerQtyPerPack || item.innerUnitsPerPack || 0);
    const baseQtyPerInner = Number(item.baseQtyPerInner || item.baseQuantityPerInner || 0);
    const measurements = [{ quantity, unit: packUnit }];

    if (innerUnit && innerQtyPerPack && innerQtyPerPack !== 1) {
      measurements.push({
        quantity: quantity * innerQtyPerPack,
        unit: innerUnit
      });
    }

    const baseMeasurement = {
      quantity: quantity * unitsPerPack,
      unit: baseUnit
    };

    if (baseQtyPerInner && innerUnit && baseQtyPerInner === 1 && innerUnit === baseUnit) {
      return measurements.map(formatMeasurement).join(" = ");
    }

    if (!sameMeasurement(measurements[measurements.length - 1], baseMeasurement)) {
      measurements.push(baseMeasurement);
    }

    return measurements.map(formatMeasurement).join(" = ");
  }

  function buildStockExplanation(item) {
    const packQuantity = getPackQuantity(item);
    const packUnit = getPackUnit(item);
    const baseUnit = getBaseUnit(item);
    const baseQuantity = Number(item.currentBaseQuantity || 0);
    const innerUnit = getInnerUnit(item);
    const innerQtyPerPack = getInnerQtyPerPack(item);
    const baseQtyPerInner = getBaseQtyPerInner(item)
      || (innerQtyPerPack ? getUnitsPerPack(item) / innerQtyPerPack : 0);
    const parts = [];

    if (packUnit) {
      parts.push(formatMeasurement({ quantity: packQuantity, unit: packUnit }));
    }

    if (innerUnit && innerQtyPerPack && innerQtyPerPack !== 1) {
      parts.push(formatMeasurement({
        quantity: packQuantity * innerQtyPerPack,
        unit: innerUnit
      }));
    }

    const baseMeasurement = { quantity: baseQuantity, unit: baseUnit };

    if (baseUnit && !parts.some((part) => part === formatMeasurement(baseMeasurement))) {
      parts.push(formatMeasurement(baseMeasurement));
    }

    if (parts.length <= 1) {
      return parts[0] || "";
    }

    const note = innerUnit && baseQtyPerInner
      ? ` (1 ${innerUnit} = ${formatQuantityForUnit(baseQtyPerInner, baseUnit)} ${baseUnit})`
      : packUnit && baseUnit && getUnitsPerPack(item) !== 1
        ? ` (1 ${packUnit} = ${formatQuantityForUnit(getUnitsPerPack(item), baseUnit)} ${baseUnit})`
        : "";

    return `${parts.join(", ")}${note}`;
  }

  function formatLocationSummary(item) {
    const activeLocations = getLocationRows(item)
      .filter((row) => Number(row.currentBaseQuantity || 0) !== 0);
    const count = activeLocations.length || getLocationRows(item).length;

    return `${count} location${count === 1 ? "" : "s"}`;
  }

  function getVisibleColumns() {
    try {
      const stored = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY) || "null");

      if (Array.isArray(stored)) {
        const valid = stored.filter((key) => COLUMNS.some((column) => column.key === key));
        return Array.from(new Set([...LOCKED_COLUMNS, ...valid]));
      }
    } catch {
      localStorage.removeItem(COLUMN_STORAGE_KEY);
    }

    return DEFAULT_COLUMNS;
  }

  function setVisibleColumns(columns) {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columns));
  }

  function isColumnVisible(key) {
    return getVisibleColumns().includes(key);
  }

  function updateColumnVisibility() {
    const visibleColumns = getVisibleColumns();

    document.querySelectorAll("[data-column]").forEach((element) => {
      element.hidden = !visibleColumns.includes(element.dataset.column);
    });
  }

  function renderColumnMenu() {
    const list = document.getElementById("inventoryColumnList");

    if (!list) {
      return;
    }

    const visibleColumns = getVisibleColumns();
    list.innerHTML = COLUMNS.map((column) => {
      const locked = LOCKED_COLUMNS.includes(column.key);
      return `
        <label class="np-column-choice">
          <input type="checkbox" value="${column.key}" ${visibleColumns.includes(column.key) ? "checked" : ""} ${locked ? "disabled" : ""}>
          <span>${column.label}</span>
        </label>
      `;
    }).join("");
  }

  function toggleColumn(key, enabled) {
    if (LOCKED_COLUMNS.includes(key)) {
      return;
    }

    const visibleColumns = getVisibleColumns();
    const nextColumns = enabled
      ? Array.from(new Set([...visibleColumns, key]))
      : visibleColumns.filter((column) => column !== key);

    setVisibleColumns(nextColumns);
    updateColumnVisibility();
  }

  function getFilteredItems() {
    const search = document.getElementById("inventorySearch");
    const categoryFilter = document.getElementById("inventoryCategoryFilter");
    const locationFilter = document.getElementById("inventoryLocationFilter");
    const nonZeroOnly = document.getElementById("inventoryNonZeroOnly");
    const query = normalize(search?.value);
    const category = categoryFilter?.value || "";
    const location = locationFilter?.value || "";
    const onlyNonZero = Boolean(nonZeroOnly?.checked);

    return buildGroupedItems().filter((item) => {
      const locationRows = getLocationRows(item);
      const haystack = [
        item.skuCode,
        item.description,
        item.categoryCode,
        ...locationRows.flatMap((row) => [row.locationCode, row.locationName])
      ].map(normalize).join(" ");

      const matchesQuery = haystack.includes(query);
      const matchesCategory = !category || item.categoryCode === category;
      const matchesLocation = !location || locationRows.some((row) => row.locationCode === location);
      const matchesNonZero = !onlyNonZero || Number(item.currentBaseQuantity || 0) !== 0;

      return matchesQuery && matchesCategory && matchesLocation && matchesNonZero;
    });
  }

  function render() {
    const body = document.getElementById("inventoryTableBody");
    const mobileList = document.getElementById("inventoryMobileList");
    const count = document.getElementById("inventoryCount");

    if (!body) {
      return;
    }

    const filtered = getFilteredItems();

    if (count) {
      count.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
    }

    if (filtered.length === 0) {
      body.innerHTML = `<tr><td colspan="6" class="np-empty-cell">No inventory rows found.</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">No inventory items found.</div>`;
      updateColumnVisibility();
      return;
    }

    body.innerHTML = filtered.map((item) => `
      <tr data-inventory-item="${escapeHtml(getItemKey(item))}">
        <td data-column="item">
          <div class="np-item-cell">
            ${renderThumb(item)}
            <div class="np-item-main">
              <strong>${escapeHtml(item.description || "")}</strong>
              <span>${escapeHtml(item.skuCode || "")}</span>
            </div>
          </div>
        </td>
        <td data-column="category">${escapeHtml(item.categoryCode || "")}</td>
        <td data-column="location">${escapeHtml(formatLocationSummary(item))}</td>
        <td data-column="packageStock" class="text-end">
          <span class="np-stock-cell">
            <strong>${formatQuantityForUnit(getPackQuantity(item), getPackUnit(item))}</strong>
            <span>${escapeHtml(getPackUnit(item))}</span>
          </span>
        </td>
        <td data-column="baseStock" class="text-end">
          <span class="np-stock-cell">
            <strong>${formatQuantityForUnit(item.currentBaseQuantity, getBaseUnit(item))}</strong>
            <span>${escapeHtml(getBaseUnit(item))}</span>
          </span>
        </td>
        <td data-column="actions" class="text-end">
          <span class="np-action-cluster">
            <button class="np-row-action is-primary" type="button" data-inventory-action="receive" data-item-key="${escapeHtml(getItemKey(item))}" aria-label="Receive ${escapeHtml(item.skuCode)}" title="Receive">
              <i class="bi bi-inboxes"></i>
            </button>
            <button class="np-row-action" type="button" data-inventory-action="details" data-item-key="${escapeHtml(getItemKey(item))}" aria-label="Open details for ${escapeHtml(item.skuCode)}" title="Details">
              <i class="bi bi-layout-sidebar-reverse"></i>
            </button>
          </span>
        </td>
      </tr>
    `).join("");

    if (mobileList) {
      mobileList.innerHTML = filtered.map((item) => `
        <article class="np-mobile-record-card" data-inventory-item="${escapeHtml(getItemKey(item))}">
          <div class="np-mobile-record-head">
            <div class="np-mobile-record-title"><strong>${escapeHtml(item.description || "")}</strong><span>${escapeHtml(item.skuCode || "")}</span></div>
            ${renderThumb(item)}
          </div>
          <p class="np-mobile-record-copy">${escapeHtml(formatLocationSummary(item))} · ${escapeHtml(item.categoryCode || "")}</p>
          ${renderMeasurements(item)}
          <div class="np-mobile-record-actions">
            <button class="np-primary-button" type="button" data-inventory-action="receive" data-item-key="${escapeHtml(getItemKey(item))}"><i class="bi bi-inboxes"></i> Receive</button>
            <button class="btn btn-sm btn-outline-light-subtle" type="button" data-inventory-action="adjust" data-item-key="${escapeHtml(getItemKey(item))}"><i class="bi bi-clipboard2-pulse"></i> Adjust</button>
            <button class="btn btn-sm btn-outline-light-subtle" type="button" data-inventory-action="details" data-item-key="${escapeHtml(getItemKey(item))}"><i class="bi bi-layout-sidebar-reverse"></i> Details</button>
          </div>
        </article>`).join("");
    }

    updateColumnVisibility();
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function setOptions(select, values, placeholder) {
    if (!select) {
      return;
    }

    const currentValue = select.value;
    select.innerHTML = [
      `<option value="">${placeholder}</option>`,
      ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    ].join("");
    select.value = values.includes(currentValue) ? currentValue : "";
  }

  function updateFilters() {
    setOptions(
      document.getElementById("inventoryCategoryFilter"),
      uniqueSorted(items.map((item) => item.categoryCode)),
      "All categories"
    );

    const locations = uniqueSorted(items.map((item) => item.locationCode));
    const locationNamesByCode = new Map(items.map((item) => [
      item.locationCode,
      item.locationName || item.locationCode
    ]));
    const locationSelect = document.getElementById("inventoryLocationFilter");
    const currentValue = locationSelect?.value || "";

    if (locationSelect) {
      locationSelect.innerHTML = [
        `<option value="">All locations</option>`,
        ...locations.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(locationNamesByCode.get(code))}</option>`)
      ].join("");
      locationSelect.value = locations.includes(currentValue) ? currentValue : "";
    }
  }

  function findItemByKey(key) {
    return buildGroupedItems().find((item) => getItemKey(item) === key) || null;
  }

  function renderLocationBreakdown(item) {
    const container = document.getElementById("inventoryDrawerLocations");
    const count = document.getElementById("inventoryDrawerLocationCount");

    if (!container) {
      return;
    }

    const rows = getLocationRows(item)
      .filter((row) => Number(row.currentBaseQuantity || 0) !== 0)
      .sort((left, right) => Number(right.currentBaseQuantity || 0) - Number(left.currentBaseQuantity || 0));
    const visibleRows = rows.length ? rows : getLocationRows(item);

    if (count) {
      count.textContent = `${visibleRows.length} location${visibleRows.length === 1 ? "" : "s"}`;
    }

    if (visibleRows.length === 0) {
      container.innerHTML = `<div class="np-empty-state-compact">No stock found by location.</div>`;
      return;
    }

    container.innerHTML = visibleRows.map((row) => `
      <div class="np-location-stock-row">
        <div class="np-location-stock-name">
          <strong>${escapeHtml(row.locationName || row.locationCode || "Location")}</strong>
          <span>${escapeHtml(row.locationCode || "")}</span>
        </div>
        <div class="np-location-stock-values">
          <span><strong>${formatQuantityForUnit(getOperationalMeasurement(row).quantity, getOperationalMeasurement(row).unit)}</strong> ${escapeHtml(getOperationalMeasurement(row).unit)}</span>
          <small>${formatQuantityForUnit(row.currentBaseQuantity, getBaseUnit(row))} ${escapeHtml(getBaseUnit(row))}</small>
        </div>
      </div>
    `).join("");
  }

  function renderMovements(movements, item) {
    const container = document.getElementById("inventoryDrawerMovements");
    const count = document.getElementById("inventoryDrawerMovementCount");

    if (count) {
      count.textContent = `${movements.length} movement${movements.length === 1 ? "" : "s"}`;
    }

    if (!container) {
      return;
    }

    if (movements.length === 0) {
      container.innerHTML = `<div class="np-empty-state-compact">No posted movement found for this SKU yet.</div>`;
      return;
    }

    container.innerHTML = movements.map((movement) => {
      const direction = movementDirection(movement);
      const containerUnit = movement.containerUnit || getPackUnit(item);
      const baseUnit = movement.baseUnit || getBaseUnit(item);
      const containerQty = formatQuantityForUnit(movement.containerQuantity, containerUnit);
      const baseQty = formatQuantityForUnit(movement.baseQuantity, baseUnit);
      const balanceText = buildMovementBalanceText(movement, containerUnit, baseUnit);

      return `
        <div class="np-movement-row">
          <span class="np-movement-icon ${direction.className}">
            <i class="bi ${direction.icon}"></i>
          </span>
          <div class="np-movement-main">
            <strong>${escapeHtml(direction.label)} · ${escapeHtml(formatMovementType(movement.transactionType))}</strong>
            <span>${escapeHtml(direction.location || movement.externalReference || "Inventory")}</span>
            ${movement.notes ? `<small>${escapeHtml(movement.notes)}</small>` : ""}
            ${balanceText ? `<small class="np-movement-balance">${escapeHtml(balanceText)}</small>` : ""}
          </div>
          <div class="np-movement-values">
            <strong>${containerQty} ${escapeHtml(containerUnit)}</strong>
            <span>${baseQty} ${escapeHtml(baseUnit)}</span>
            <small>${escapeHtml(formatDateTime(movement.transactionTime))}</small>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadDrawerMovements(item) {
    const container = document.getElementById("inventoryDrawerMovements");
    const count = document.getElementById("inventoryDrawerMovementCount");
    const skuCode = item?.skuCode || "";

    if (!container || !skuCode) {
      return;
    }

    if (count) {
      count.textContent = "Loading";
    }
    container.innerHTML = `<div class="np-empty-state-compact">Loading recent movements...</div>`;

    try {
      const movements = await window.NextPulse.api.get(`/inventory/items/${encodeURIComponent(skuCode)}/movements`);

      if (selectedItem?.skuCode !== skuCode) {
        return;
      }

      renderMovements(movements, item);
    } catch (exception) {
      if (selectedItem?.skuCode !== skuCode) {
        return;
      }

      if (count) {
        count.textContent = "Unavailable";
      }
      container.innerHTML = `<div class="np-empty-state-compact">${escapeHtml(exception.message || "Unable to load recent movements.")}</div>`;
    }
  }

  function openDrawer(item) {
    selectedItem = item;

    if (!item) {
      return;
    }

    const drawer = document.getElementById("inventoryDrawer");
    const backdrop = document.getElementById("inventoryDrawerBackdrop");
    const thumb = document.getElementById("inventoryDrawerThumb");

    if (thumb) {
      thumb.outerHTML = renderThumb(item, "np-item-thumb-lg").replace("np-item-thumb", "np-item-thumb");
      const nextThumb = document.querySelector("#inventoryDrawer .np-item-thumb-lg");
      if (nextThumb) {
        nextThumb.id = "inventoryDrawerThumb";
      }
    }

    document.getElementById("inventoryDrawerCategory").textContent = item.categoryCode || "Inventory";
    document.getElementById("inventoryDrawerTitle").textContent = item.description || item.skuCode || "Inventory item";
    document.getElementById("inventoryDrawerSku").textContent = `${item.skuCode || ""} · Total on hand`;
    const operationalMeasurement = getOperationalMeasurement(item);
    document.getElementById("inventoryDrawerPackageStock").textContent = `${formatQuantityForUnit(operationalMeasurement.quantity, operationalMeasurement.unit)} ${operationalMeasurement.unit}`;
    document.getElementById("inventoryDrawerBaseStock").textContent = `${formatQuantityForUnit(item.currentBaseQuantity, getBaseUnit(item))} ${getBaseUnit(item)}`;
    document.getElementById("inventoryDrawerConversion").textContent = buildStockExplanation(item);
    renderLocationBreakdown(item);
    loadDrawerMovements(item);

    drawer?.classList.add("is-open");
    drawer?.setAttribute("aria-hidden", "false");
    if (backdrop) {
      backdrop.hidden = false;
    }
  }

  function updateAdjustmentPreview() {
    if (!selectedItem) return;
    const locationCode = document.getElementById("inventoryAdjustmentLocation")?.value;
    const row = getLocationRows(selectedItem).find((entry) => entry.locationCode === locationCode);
    const mode = document.getElementById("inventoryAdjustmentMode")?.value;
    const quantity = Number(document.getElementById("inventoryAdjustmentQuantity")?.value || 0);
    const reason = document.querySelector("input[name='inventoryReason']:checked")?.value;
    const isProductionUse = reason === "USE";
    const batchWrap = document.getElementById("inventoryAdjustmentBatchWrap");
    const note = document.getElementById("inventoryAdjustmentNote");
    const noteLabel = document.getElementById("inventoryAdjustmentNoteLabel");
    if (batchWrap) batchWrap.hidden = !isProductionUse;
    if (note) {
      note.required = !isProductionUse;
      note.placeholder = isProductionUse ? "Add a production note if needed" : "What happened and why?";
    }
    if (noteLabel) noteLabel.innerHTML = isProductionUse ? "Note (optional)" : "Note <b aria-hidden=\"true\">*</b>";
    const unit = mode === "BASE" ? getBaseUnit(selectedItem) : getPackUnit(selectedItem);
    const quantityInput = document.getElementById("inventoryAdjustmentQuantity");
    quantityInput.step = isWholeUnit(unit) ? "1" : "0.01";
    const current = mode === "BASE" ? Number(row?.currentBaseQuantity || 0) : getPackQuantity(row || selectedItem);
    document.getElementById("inventoryAdjustmentQuantityLabel").textContent = reason === "PHYSICAL_COUNT" ? "Counted quantity" : "Quantity";
    document.getElementById("inventoryAdjustmentPreview").textContent = reason === "PHYSICAL_COUNT"
      ? `Current: ${formatQuantityForUnit(current, unit)} ${unit}. Enter the total physically counted.`
      : `Available here: ${formatQuantityForUnit(current, unit)} ${unit}${quantity ? ` · After: ${formatQuantityForUnit(Math.max(0, current - quantity), unit)} ${unit}` : ""}`;
  }

  function renderProductionBatches() {
    const container = document.getElementById("inventoryAdjustmentBatches");
    const help = document.getElementById("inventoryAdjustmentBatchHelp");
    if (!container) return;

    if (!batchesLoaded) {
      container.innerHTML = `<div class="np-batch-empty">Loading open batches...</div>`;
      return;
    }
    if (!openProductionBatches.length) {
      container.innerHTML = `<div class="np-batch-empty">No open production batch is available.</div>`;
      if (help) help.textContent = "Start a manufacturing batch before posting production use.";
      return;
    }

    container.innerHTML = openProductionBatches.map((batch, index) => `
      <label class="np-batch-choice">
        <input type="radio" name="inventoryProductionBatch" value="${escapeHtml(batch.productionBatchId)}" ${index === 0 ? "checked" : ""}>
        <span>
          <strong>${escapeHtml(batch.batchNumber || "Production batch")}</strong>
          <small>${escapeHtml(batch.finishedDescription || batch.finishedSkuCode || batch.recipeName || "")} · ${escapeHtml(batch.status || "")}</small>
          <em>${formatQuantityForUnit(batch.plannedOutputQuantity, "ADET")}</em>
        </span>
      </label>
    `).join("");
    if (help) help.textContent = "This movement will be linked to the selected manufacturing batch.";
  }

  async function loadProductionBatches() {
    renderProductionBatches();
    try {
      openProductionBatches = await window.NextPulse.api.get("/production/batches/open");
    } catch (exception) {
      openProductionBatches = [];
      const help = document.getElementById("inventoryAdjustmentBatchHelp");
      if (help) help.textContent = exception.message || "Open batches could not be loaded.";
    } finally {
      batchesLoaded = true;
      renderProductionBatches();
    }
  }

  function openAdjustment(item) {
    selectedItem = item;
    if (!item) return;
    const sheet = document.getElementById("inventoryAdjustmentSheet");
    document.getElementById("inventoryAdjustmentTitle").textContent = item.description || item.skuCode;
    document.getElementById("inventoryAdjustmentLocation").innerHTML = getLocationRows(item).map((row) =>
      `<option value="${escapeHtml(row.locationCode)}">${escapeHtml(row.locationName || row.locationCode)}</option>`
    ).join("");
    document.getElementById("inventoryAdjustmentMode").innerHTML = `
      <option value="CONTAINER">${escapeHtml(getPackUnit(item))}</option>
      <option value="BASE">${escapeHtml(getBaseUnit(item))}</option>`;
    document.getElementById("inventoryAdjustmentQuantity").value = "";
    document.getElementById("inventoryAdjustmentNote").value = "";
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
    if (!batchesLoaded) loadProductionBatches();
    else renderProductionBatches();
    updateAdjustmentPreview();
    window.setTimeout(() => document.getElementById("inventoryAdjustmentQuantity")?.focus(), 0);
  }

  function closeAdjustment() {
    const sheet = document.getElementById("inventoryAdjustmentSheet");
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
  }

  async function submitAdjustment(event) {
    event.preventDefault();
    const quantity = Number(document.getElementById("inventoryAdjustmentQuantity").value);
    const note = document.getElementById("inventoryAdjustmentNote").value.trim();
    const reasonCode = document.querySelector("input[name='inventoryReason']:checked").value;
    const productionBatchId = document.querySelector("input[name='inventoryProductionBatch']:checked")?.value || null;
    const form = document.getElementById("inventoryAdjustmentForm");
    if (!Number.isFinite(quantity) || quantity < 0 || (reasonCode !== "USE" && !note)) {
      form?.reportValidity();
      return;
    }
    if (reasonCode === "USE" && !productionBatchId) {
      await window.NextPulse.ui.confirmAction({
        type: "warning",
        kicker: "Production batch required",
        title: "Select an open batch",
        message: "Production use must be linked to the manufacturing batch that consumes this material.",
        cancelLabel: "Close",
        confirmLabel: "Choose batch"
      });
      return;
    }
    const selectedBatch = openProductionBatches.find((batch) => batch.productionBatchId === productionBatchId);
    const confirmed = await window.NextPulse.ui.confirmAction({
      type: reasonCode === "PHYSICAL_COUNT" ? "info" : "warning",
      kicker: "Inventory ledger",
      title: reasonCode === "PHYSICAL_COUNT" ? "Post physical count?" : reasonCode === "USE" ? "Post production use?" : "Reduce inventory?",
      message: `${selectedItem.description}: ${quantity} ${document.getElementById("inventoryAdjustmentMode").selectedOptions[0].textContent}`,
      detail: reasonCode === "USE"
        ? `${selectedBatch?.batchNumber || "Production batch"}${note ? ` · ${note}` : ""}`
        : note,
      confirmLabel: "Post movement"
    });
    if (!confirmed) return;
    await window.NextPulse.api.post("/inventory/adjustments", {
      skuCode: selectedItem.skuCode,
      locationCode: document.getElementById("inventoryAdjustmentLocation").value,
      reasonCode,
      quantityMode: document.getElementById("inventoryAdjustmentMode").value,
      quantity,
      note,
      productionBatchId
    });
    closeAdjustment();
    await load();
    const refreshed = findItemByKey(selectedItem.skuCode);
    if (document.getElementById("inventoryDrawer")?.classList.contains("is-open")) openDrawer(refreshed);
  }

  function closeDrawer() {
    const drawer = document.getElementById("inventoryDrawer");
    const backdrop = document.getElementById("inventoryDrawerBackdrop");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
    if (backdrop) {
      backdrop.hidden = true;
    }
  }

  function receiveItem(item) {
    if (!item) {
      return;
    }

    closeDrawer();
    window.NextPulse.ui.showPage("receiving", "Receiving");
    window.NextPulse.receiving?.prefillSku(item.skuCode);
  }

  function transferItem(item) {
    if (!item) {
      return;
    }

    closeDrawer();
    window.NextPulse.ui.showPage("transfers", "Transfers");
    window.NextPulse.transfer?.prefillSku(item.skuCode);
  }

  async function load() {
    const body = document.getElementById("inventoryTableBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="6" class="np-empty-cell">Loading inventory...</td></tr>`;
    }

    try {
      items = await window.NextPulse.api.get("/inventory/summary");
      hasLoaded = true;
      updateFilters();
      render();
    } catch (exception) {
      if (body) {
        body.innerHTML = `<tr><td colspan="6" class="np-empty-cell">${escapeHtml(exception.message || "Unable to load inventory.")}</td></tr>`;
      }
      const mobileList = document.getElementById("inventoryMobileList");
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">${escapeHtml(exception.message || "Unable to load inventory.")}</div>`;
    }
  }

  async function prefillUse(skuCode) {
    if (!hasLoaded) await load();
    const item = findItemByKey(skuCode);
    if (item) openAdjustment(item);
  }

  function initColumnControls() {
    const popover = document.getElementById("inventoryColumnPopover");
    const button = document.getElementById("inventoryColumnsButton");

    renderColumnMenu();

    button?.addEventListener("click", () => {
      const nextHidden = !popover?.hidden;
      if (popover) {
        popover.hidden = nextHidden;
      }
      button.setAttribute("aria-expanded", String(!nextHidden));
    });

    document.getElementById("inventoryColumnsClose")?.addEventListener("click", () => {
      if (popover) {
        popover.hidden = true;
      }
      button?.setAttribute("aria-expanded", "false");
    });

    document.getElementById("inventoryColumnList")?.addEventListener("change", (event) => {
      const input = event.target.closest("input[type='checkbox']");
      if (input) {
        toggleColumn(input.value, input.checked);
      }
    });

    document.addEventListener("click", (event) => {
      if (!popover || popover.hidden) {
        return;
      }

      if (!event.target.closest("#inventoryColumnPopover") && !event.target.closest("#inventoryColumnsButton")) {
        popover.hidden = true;
        button?.setAttribute("aria-expanded", "false");
      }
    });
  }

  function init() {
    const filters = document.querySelector(".np-inventory-filters");
    if (filters && window.matchMedia("(min-width: 768px)").matches) filters.open = true;
    initColumnControls();
    document.getElementById("refreshInventory")?.addEventListener("click", load);
    document.getElementById("inventorySearch")?.addEventListener("input", render);
    document.getElementById("inventoryCategoryFilter")?.addEventListener("change", render);
    document.getElementById("inventoryLocationFilter")?.addEventListener("change", render);
    document.getElementById("inventoryNonZeroOnly")?.addEventListener("change", render);
    document.getElementById("inventoryScanBarcode")?.addEventListener("click", () =>
      window.NextPulse.receiving?.openScanner?.({ actionMode: true }));
    document.getElementById("inventoryDrawerClose")?.addEventListener("click", closeDrawer);
    document.getElementById("inventoryDrawerBack")?.addEventListener("click", closeDrawer);
    document.getElementById("inventoryDrawerBackdrop")?.addEventListener("click", closeDrawer);
    document.getElementById("inventoryDrawerReceive")?.addEventListener("click", () => receiveItem(selectedItem));
    document.getElementById("inventoryDrawerTransfer")?.addEventListener("click", () => transferItem(selectedItem));
    document.getElementById("inventoryDrawerAdjust")?.addEventListener("click", () => openAdjustment(selectedItem));
    document.getElementById("inventoryAdjustmentClose")?.addEventListener("click", closeAdjustment);
    document.getElementById("inventoryAdjustmentForm")?.addEventListener("submit", (event) => submitAdjustment(event).catch((exception) => window.NextPulse.ui.confirmAction({ type: "danger", kicker: "Could not post", title: "Inventory was not changed", message: exception.message, cancelLabel: "Close", confirmLabel: "Try again" })));
    ["inventoryAdjustmentLocation", "inventoryAdjustmentMode", "inventoryAdjustmentQuantity"].forEach((id) => document.getElementById(id)?.addEventListener("input", updateAdjustmentPreview));
    document.querySelectorAll("input[name='inventoryReason']").forEach((input) => input.addEventListener("change", updateAdjustmentPreview));

    document.getElementById("inventoryTableBody")?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-inventory-action]");
      const row = event.target.closest("[data-inventory-item]");
      const key = actionButton?.dataset.itemKey || row?.dataset.inventoryItem;
      const item = findItemByKey(key);

      if (!item) {
        return;
      }

      if (actionButton) {
        event.stopPropagation();
        if (actionButton.dataset.inventoryAction === "receive") {
          receiveItem(item);
          return;
        }
        if (actionButton.dataset.inventoryAction === "adjust") { openAdjustment(item); return; }
      }

      openDrawer(item);
    });

    document.getElementById("inventoryMobileList")?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-inventory-action]");
      const card = event.target.closest("[data-inventory-item]");
      const item = findItemByKey(actionButton?.dataset.itemKey || card?.dataset.inventoryItem);
      if (!item) return;
      if (actionButton?.dataset.inventoryAction === "receive") receiveItem(item);
      else if (actionButton?.dataset.inventoryAction === "adjust") openAdjustment(item);
      else openDrawer(item);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDrawer();
      }
    });

    document.addEventListener("nextpulse:page-change", (event) => {
      if (event.detail?.page === "inventory" && !hasLoaded) {
        load();
      }
    });
  }

  return {
    init,
    load,
    refresh: load,
    prefillUse
  };
})();

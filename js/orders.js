window.NextPulse = window.NextPulse || {};

window.NextPulse.orders = (() => {
  let orders = [];
  let initialized = false;
  let loaded = false;
  let expandedOrderId = null;

  const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;");
  const formatDate = (value) => value ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";
  const statusLabel = (status) => ({ IMPORTED: "Imported", RESERVED: "Reserved", CLOSED: "Closed", CONFIRMED: "Confirmed", IN_PROGRESS: "In progress", FULFILLED: "Fulfilled", CANCELLED: "Cancelled" })[status] || status || "Unknown";

  function actionMarkup(detail) {
    if (detail.orderStatus === "IMPORTED") {
      return `<button class="np-primary-button" type="button" data-order-action="reserve" data-order-id="${detail.salesOrderId}"><i class="bi bi-box-arrow-in-down"></i> Fulfill / Reserve from Hedef</button>`;
    }
    if (detail.orderStatus === "RESERVED") {
      return `<button class="np-primary-button" type="button" data-order-action="close" data-order-id="${detail.salesOrderId}"><i class="bi bi-check2-circle"></i> Close & Ship Order</button>`;
    }
    return "";
  }

  function showMessage(message, type = "") {
    const element = document.getElementById("ordersMessage");
    if (!element) return;
    element.hidden = !message;
    element.textContent = message || "";
    element.className = `np-alert np-orders-alert${type ? ` is-${type}` : ""}`;
  }

  function filteredOrders() {
    const search = document.getElementById("ordersSearch")?.value.trim().toLowerCase() || "";
    const status = document.getElementById("ordersStatusFilter")?.value || "";
    return orders.filter((order) => {
      const haystack = [order.orderNumber, order.externalOrderNumber, order.customerName, order.customerBranch, order.shippingAddress, order.sourceFilename].join(" ").toLowerCase();
      return (!search || haystack.includes(search)) && (!status || order.orderStatus === status);
    });
  }

  function updateStats() {
    const open = orders.filter((order) => !["CLOSED", "FULFILLED", "CANCELLED"].includes(order.orderStatus));
    const delivery = open.map((order) => order.requestedDeliveryDate).filter(Boolean).sort()[0];
    document.getElementById("ordersTotal").textContent = orders.length;
    document.getElementById("ordersOpen").textContent = open.length;
    document.getElementById("ordersNextDelivery").textContent = formatDate(delivery);
  }

  function render() {
    const rows = filteredOrders();
    const body = document.getElementById("ordersTableBody");
    const mobileList = document.getElementById("ordersMobileList");
    document.getElementById("ordersCount").textContent = `${rows.length} order${rows.length === 1 ? "" : "s"}`;
    updateStats();
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="8" class="np-empty-cell">No matching orders.</td></tr>`;
      if (mobileList) mobileList.innerHTML = `<div class="np-mobile-empty">No matching orders.</div>`;
      return;
    }
    body.innerHTML = rows.map((order) => `
      <tr data-order-row="${order.salesOrderId}">
        <td><span class="np-order-number"><strong>${escapeHtml(order.orderNumber)}</strong><small>${escapeHtml(order.externalOrderNumber)}</small></span></td>
        <td>${escapeHtml(order.customerName)}<br><small>${escapeHtml(order.customerBranch || "")}</small></td><td>${formatDate(order.orderDate)}</td><td><strong>${formatDate(order.requestedDeliveryDate)}</strong></td>
        <td><span class="np-order-status" data-status="${escapeHtml(order.orderStatus)}">${escapeHtml(statusLabel(order.orderStatus))}</span></td>
        <td class="text-end">${Number(order.lineCount || 0)}</td>
        <td><span class="np-order-source"><i class="bi bi-file-earmark-pdf"></i> Email PDF<br><small>${escapeHtml(order.sourceFilename)}</small></span></td>
        <td class="text-end"><button class="np-row-action" type="button" aria-label="View order"><i class="bi bi-chevron-down"></i></button></td>
      </tr><tr class="np-order-detail-row" data-order-detail="${order.salesOrderId}" hidden><td colspan="8">Loading order lines…</td></tr>`).join("");

    if (mobileList) mobileList.innerHTML = rows.map((order) => `
      <article class="np-mobile-record-card" data-mobile-order="${order.salesOrderId}">
        <div class="np-mobile-record-head"><div class="np-mobile-record-title"><strong>${escapeHtml(order.orderNumber)}</strong><span>${escapeHtml(order.customerBranch || order.customerName)} · ${escapeHtml(order.externalOrderNumber)}</span></div><span class="np-order-status" data-status="${escapeHtml(order.orderStatus)}">${escapeHtml(statusLabel(order.orderStatus))}</span></div>
        <div class="np-mobile-record-grid">
          <div class="np-mobile-record-metric"><span>Delivery</span><strong>${formatDate(order.requestedDeliveryDate)}</strong></div>
          <div class="np-mobile-record-metric"><span>Order date</span><strong>${formatDate(order.orderDate)}</strong></div>
          <div class="np-mobile-record-metric"><span>Lines</span><strong>${Number(order.lineCount || 0)}</strong></div>
          <div class="np-mobile-record-metric"><span>Source</span><strong>Email PDF</strong></div>
        </div>
        <p class="np-mobile-record-copy"><i class="bi bi-file-earmark-pdf"></i> ${escapeHtml(order.sourceFilename)}</p>
        <button class="btn btn-sm btn-outline-light-subtle" type="button" data-mobile-order-open="${order.salesOrderId}"><i class="bi bi-chevron-down"></i> View order lines</button>
        <div data-mobile-order-detail="${order.salesOrderId}" hidden></div>
      </article>`).join("");
  }

  async function toggleDetail(orderId) {
    const row = document.querySelector(`[data-order-detail="${CSS.escape(orderId)}"]`);
    if (!row) return;
    if (expandedOrderId === orderId && !row.hidden) { row.hidden = true; expandedOrderId = null; return; }
    document.querySelectorAll("[data-order-detail]").forEach((item) => { item.hidden = true; });
    row.hidden = false;
    expandedOrderId = orderId;
    try {
      const detail = await window.NextPulse.api.get(`/orders/${orderId}`);
      row.querySelector("td").innerHTML = detail.lines?.length
        ? `<div class="np-order-delivery"><strong><i class="bi bi-geo-alt"></i> ${escapeHtml(detail.customerBranch || "Delivery location")}</strong><span>${escapeHtml(detail.shippingAddress || "Address not available")}</span></div><div class="np-order-lines">${detail.lines.map((line) => `<div class="np-order-line"><strong>${escapeHtml(line.externalItemCode || `Line ${line.lineNumber}`)}</strong><span>${escapeHtml(line.itemDescription)}</span><span>${Number(line.orderedQuantity).toLocaleString("tr-TR")} ${escapeHtml(line.unitOfMeasure)}</span></div>`).join("")}</div><div class="np-form-actions">${actionMarkup(detail)}</div>`
        : `<div class="np-empty-state-compact">No order lines found.</div>`;
    } catch (error) { row.querySelector("td").textContent = error.message || "Unable to load order details."; }
  }

  async function toggleMobileDetail(orderId) {
    const container = document.querySelector(`[data-mobile-order-detail="${CSS.escape(orderId)}"]`);
    const card = container?.closest("[data-mobile-order]");
    if (!container) return;
    if (!container.hidden) {
      container.hidden = true;
      card?.classList.remove("is-expanded");
      return;
    }
    document.querySelectorAll("[data-mobile-order-detail]").forEach((detail) => {
      detail.hidden = true;
      detail.closest("[data-mobile-order]")?.classList.remove("is-expanded");
    });
    container.hidden = false;
    card?.classList.add("is-expanded");
    container.innerHTML = `<div class="np-mobile-record-copy">Loading order lines…</div>`;
    try {
      const detail = await window.NextPulse.api.get(`/orders/${orderId}`);
      container.innerHTML = detail.lines?.length
        ? `<div class="np-order-delivery"><strong><i class="bi bi-geo-alt"></i> ${escapeHtml(detail.customerBranch || "Delivery location")}</strong><span>${escapeHtml(detail.shippingAddress || "Address not available")}</span></div><div class="np-order-lines">${detail.lines.map((line) => `<div class="np-order-line"><strong>${escapeHtml(line.externalItemCode || `Line ${line.lineNumber}`)}</strong><span>${escapeHtml(line.itemDescription)}</span><span>${Number(line.orderedQuantity).toLocaleString("tr-TR")} ${escapeHtml(line.unitOfMeasure)}</span></div>`).join("")}</div><div class="np-form-actions">${actionMarkup(detail)}</div>`
        : `<div class="np-mobile-empty">No order lines found.</div>`;
    } catch (error) { container.textContent = error.message || "Unable to load order details."; }
  }

  async function loadOrders(force = false) {
    if (loaded && !force) return;
    showMessage("");
    const body = document.getElementById("ordersTableBody");
    body.innerHTML = `<tr><td colspan="8" class="np-empty-cell">Loading orders…</td></tr>`;
    try { orders = await window.NextPulse.api.get("/orders"); loaded = true; render(); }
    catch (error) { body.innerHTML = `<tr><td colspan="8" class="np-empty-cell">Orders could not be loaded.</td></tr>`; showMessage(error.message, "error"); }
  }

  async function runOrderAction(action, orderId) {
    const label = action === "reserve" ? "reserve this order from Hedef" : "close and ship this order";
    const confirmed = await window.NextPulse.ui.confirmAction({
      type: action === "reserve" ? "warning" : "success",
      kicker: action === "reserve" ? "Inventory reservation" : "Shipment confirmation",
      title: action === "reserve" ? "Reserve order stock?" : "Close this order?",
      message: `This will ${label} and post the inventory ledger movement.`,
      confirmLabel: action === "reserve" ? "Reserve stock" : "Close & ship",
      cancelLabel: "Cancel"
    });
    if (!confirmed) return;
    try {
      const result = await window.NextPulse.api.postEmpty(`/orders/${orderId}/${action}`);
      showMessage(`${result.boxQuantity} KOLİ · ${result.cookieQuantity} ADET posted as ${result.transactionNumber}.`, "success");
      await Promise.all([loadOrders(true), window.NextPulse.inventory?.refresh?.()]);
    } catch (error) {
      showMessage(error.message || "Order inventory action failed.", "error");
    }
  }

  async function importGmail() {
    const button = document.getElementById("importGmailOrders");
    button.disabled = true;
    showMessage("Checking Gmail for unread BİM PDF orders…");
    try {
      const result = await window.NextPulse.api.postEmpty("/orders/imports/gmail");
      const summary = result.ordersImported ? `${result.ordersImported} order imported from Gmail.` : result.rejected ? `${result.rejected} PDF attachment rejected.` : "No new unread PDF orders were found.";
      showMessage(summary, result.rejected ? "error" : "success");
      await loadOrders(true);
    } catch (error) { showMessage(error.message, "error"); }
    finally { button.disabled = false; }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById("refreshOrders")?.addEventListener("click", () => loadOrders(true));
    document.getElementById("importGmailOrders")?.addEventListener("click", importGmail);
    document.getElementById("ordersSearch")?.addEventListener("input", render);
    document.getElementById("ordersStatusFilter")?.addEventListener("change", render);
    document.getElementById("ordersTableBody")?.addEventListener("click", (event) => { const row = event.target.closest("[data-order-row]"); if (row) toggleDetail(row.dataset.orderRow); });
    document.getElementById("ordersMobileList")?.addEventListener("click", (event) => { const button = event.target.closest("[data-mobile-order-open]"); if (button) toggleMobileDetail(button.dataset.mobileOrderOpen); });
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-order-action]");
      if (action) runOrderAction(action.dataset.orderAction, action.dataset.orderId);
    });
    document.addEventListener("nextpulse:page-change", (event) => { if (event.detail?.page === "orders") loadOrders(); });
  }

  return { init, reload: () => loadOrders(true) };
})();

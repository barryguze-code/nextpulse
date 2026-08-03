window.NextPulse = window.NextPulse || {};

window.NextPulse.reports = (() => {
  let loaded = false;
  let loading = false;

  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
  const number = (value) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(value || 0));
  const integer = (value) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(value || 0));
  const categoryName = (code) => ({ RAW_MATERIAL: "Hammadde", PACKAGING: "Ambalaj", FINISHED_GOOD: "Mamul" }[code] || "Diğer");
  const date = (value) => value ? new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)) : "Planlanmadı";

  function skeletons() {
    el("reportsKpis").innerHTML = Array.from({ length: 4 }, () => '<div class="np-report-skeleton"></div>').join("");
    ["reportsLocations", "reportsProduction", "reportsCategories", "reportsOrders", "reportsCritical"].forEach((id) => {
      el(id).innerHTML = '<div class="np-report-skeleton"></div><div class="np-report-skeleton"></div>';
    });
  }

  function renderKpis(data) {
    const cards = [
      ["bi-box-seam", "Stoklu SKU", data.summary.stockedSkus, `${data.summary.totalSkus} aktif SKU`, "is-good"],
      ["bi-exclamation-triangle", "Kritik stok", data.summary.lowStockSkus, `${data.summary.outOfStockSkus} stok dışı`, data.summary.lowStockSkus + data.summary.outOfStockSkus ? "is-alert" : "is-good"],
      ["bi-geo-alt", "Lokasyon", data.summary.locationCount, "Aktif stok noktası", ""],
      ["bi-clipboard-check", "Açık sipariş", data.summary.openOrders, "Sevkiyat bekleyen", ""]
    ];
    el("reportsKpis").innerHTML = cards.map(([icon, label, value, detail, tone]) => `
      <article class="np-report-kpi ${tone}"><div class="np-report-kpi-top"><span>${label}</span><i class="bi ${icon} np-report-kpi-icon"></i></div><strong>${integer(value)}</strong><small>${detail}</small></article>`).join("");
  }

  function renderStockOverview(rows) {
    if (!rows.length) { el("reportsLocations").innerHTML = '<div class="np-report-empty">Stok kartı bulunamadı.</div>'; return; }
    const locationNames = [];
    rows.forEach((row) => row.locations.forEach((location) => {
      if (!locationNames.includes(location.locationName)) locationNames.push(location.locationName);
    }));
    el("reportsStockLegend").innerHTML = `<div class="np-stock-legend-group"><b>Durum</b><span><i class="is-low"></i>Kritik altı</span><span><i class="is-near"></i>Eşiğe yakın</span><span><i class="is-healthy"></i>Yeterli</span></div><div class="np-stock-legend-group"><b>Lokasyon tonu</b>${locationNames.map((name, index) => `<span><i class="np-loc-tone-${index % 6}"></i>${escapeHtml(name)}</span>`).join("")}</div>`;
    el("reportsLocations").innerHTML = rows.map((row) => {
      const current = Number(row.currentQuantity || 0);
      const threshold = Number(row.criticalQuantity || 0);
      const scale = Math.max(current, threshold > 0 ? threshold * 1.5 : current, 1);
      const marker = threshold > 0 ? Math.min(100, threshold * 100 / scale) : null;
      const statusClass = ({ OUT_OF_STOCK: "is-out", LOW_STOCK: "is-low", NEAR_THRESHOLD: "is-near", HEALTHY: "is-healthy" })[row.status] || "is-healthy";
      const statusLabel = ({ OUT_OF_STOCK: "Stok tükendi", LOW_STOCK: "Kritik seviyenin altında", NEAR_THRESHOLD: "Kritik seviyeye yakın", HEALTHY: "Stok yeterli" })[row.status] || "Stok yeterli";
      const segments = row.locations.map((location, index) => `<span class="np-stock-segment np-loc-tone-${index % 6}" style="width:${Math.max(0, Number(location.quantity) * 100 / scale)}%" title="${escapeHtml(location.locationName)}: ${number(location.quantity)} ${escapeHtml(row.unit)}"></span>`).join("");
      const locationText = row.locations.length ? row.locations.map((location, index) => `<span><i class="np-loc-tone-${index % 6}"></i>${escapeHtml(location.locationName)} <b>${number(location.quantity)}</b></span>`).join("") : '<span>Lokasyonlarda stok yok</span>';
      return `<article class="np-stock-chart-row ${statusClass}"><div class="np-stock-row-head"><div><span class="np-stock-category">${categoryName(row.categoryCode)}</span><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(row.skuCode)}</small></div><div class="np-stock-total"><strong>${number(row.currentQuantity)} ${escapeHtml(row.unit)}</strong><span>${statusLabel}</span></div></div><div class="np-stock-track" role="img" aria-label="${escapeHtml(row.description)}: ${number(row.currentQuantity)}; kritik seviye ${number(row.criticalQuantity)} ${escapeHtml(row.unit)}">${segments}${marker !== null ? `<i class="np-threshold-marker" style="left:${marker}%"><em>Kritik ${number(row.criticalQuantity)}</em></i>` : ""}</div><div class="np-stock-location-breakdown">${locationText}</div></article>`;
    }).join("");
  }

  function renderCategories(rows) {
    el("reportsCategories").innerHTML = rows.length ? rows.map((row) => `
      <article class="np-report-category"><div class="np-report-category-title"><strong>${categoryName(row.categoryCode)}</strong><span>${row.totalSkus} SKU</span></div><div class="np-report-category-pills"><span class="np-report-pill">${row.stockedSkus} stoklu</span>${row.lowStockSkus ? `<span class="np-report-pill is-low">${row.lowStockSkus} kritik</span>` : ""}${row.outOfStockSkus ? `<span class="np-report-pill is-out">${row.outOfStockSkus} tükendi</span>` : ""}</div></article>`).join("") : '<div class="np-report-empty">Kategori verisi bulunamadı.</div>';
  }

  function renderOrders(flow) {
    el("reportsOrders").innerHTML = `
      <div class="np-report-order-step is-imported"><i class="bi bi-envelope-arrow-down"></i><span><strong>Aktarıldı</strong><small>Hazırlanmayı bekliyor</small></span><strong>${flow.imported}</strong></div>
      <div class="np-report-order-step is-shipped"><i class="bi bi-truck"></i><span><strong>Sevk edildi</strong><small>Teslimat bekleniyor</small></span><strong>${flow.shipped}</strong></div>
      <div class="np-report-order-step is-delivered"><i class="bi bi-check2-circle"></i><span><strong>Teslim edildi</strong><small>Kapanan sipariş</small></span><strong>${flow.delivered}</strong></div>
      <div class="np-report-next-delivery">Sıradaki teslimat: <b>${date(flow.nextDeliveryDate)}</b></div>`;
  }

  function varianceTone(value) {
    const variance = Math.abs(Number(value || 0));
    return variance <= 2 ? "is-good" : variance <= 5 ? "is-warning" : "is-danger";
  }

  function renderProduction(data) {
    if (!data?.history?.length) { el("reportsProduction").innerHTML = '<div class="np-report-empty">Tamamlanmış üretim partisi bulunamadı.</div>'; return; }
    el("reportsProduction").innerHTML = `<div class="np-production-report-summary"><div><span>Tamamlanan parti</span><strong>${integer(data.completedBatches)}</strong></div><div><span>Sağlam üretim</span><strong>${integer(data.goodOutput)} ADET</strong></div><div><span>Fire / Zayi</span><strong>${integer(data.wasteOutput)} ADET</strong></div><div><span>Verim</span><strong>%${number(data.yieldPercent)}</strong></div></div><div class="np-production-history">${data.history.map((run, index) => {
      const total = Math.max(Number(run.goodOutput) + Number(run.wasteOutput), Number(run.plannedOutput), 1);
      const goodWidth = Number(run.goodOutput) * 100 / total;
      const wasteWidth = Number(run.wasteOutput) * 100 / total;
      return `<details class="np-production-run" ${index === 0 ? "open" : ""}><summary><div><span>${date(run.productionDate)}</span><strong>${escapeHtml(run.batchNumber)} · ${escapeHtml(run.finishedItemDescription)}</strong></div><div class="np-production-run-result"><strong>${integer(run.goodOutput)} sağlam</strong><span class="${varianceTone(run.outputVariancePercent)}">%${number(run.yieldPercent)} verim</span><i class="bi bi-chevron-down"></i></div></summary><div class="np-production-run-body"><div class="np-output-comparison"><div class="np-output-labels"><span>Planlanan <b>${integer(run.plannedOutput)}</b></span><span>Sağlam <b>${integer(run.goodOutput)}</b></span><span>Zayi <b>${integer(run.wasteOutput)}</b></span></div><div class="np-output-bar"><span class="is-good" style="width:${goodWidth}%"></span><span class="is-waste" style="width:${wasteWidth}%"></span></div></div><div class="np-material-usage-list"><div class="np-material-usage-head"><span>Malzeme</span><span>Plan / Gerçek</span><span>Sapma</span></div>${run.materials.map((material) => `<div class="np-material-usage"><span><strong>${escapeHtml(material.description)}</strong><small>${escapeHtml(material.skuCode)}</small></span><span>${number(material.expectedQuantity)} / <b>${number(material.actualQuantity)} ${escapeHtml(material.unit)}</b></span><span class="${varianceTone(material.variancePercent)}">${Number(material.variancePercent) > 0 ? "+" : ""}%${number(material.variancePercent)}</span></div>`).join("")}</div></div></details>`;
    }).join("")}</div>`;
  }

  function renderCritical(rows) {
    if (!rows.length) { el("reportsCritical").innerHTML = '<div class="np-report-empty"><i class="bi bi-check2-circle"></i> Kritik seviyede ürün yok.</div>'; return; }
    el("reportsCritical").innerHTML = rows.map((row) => `
      <article class="np-report-critical ${row.severity === "OUT_OF_STOCK" ? "is-out" : ""}"><span class="np-report-critical-icon"><i class="bi ${row.severity === "OUT_OF_STOCK" ? "bi-x-circle" : "bi-exclamation-triangle"}"></i></span><div><div class="np-report-critical-head"><strong>${escapeHtml(row.description)}</strong><span>${row.severity === "OUT_OF_STOCK" ? "TÜKENDİ" : "KRİTİK"}</span></div><p>${escapeHtml(row.skuCode)} · ${number(row.currentQuantity)} / ${number(row.criticalQuantity)} ${escapeHtml(row.unit)}</p><div class="np-report-bar"><span style="width:${row.coveragePercent}%"></span></div></div></article>`).join("");
  }

  async function load(force = false) {
    if (loading || (loaded && !force)) return;
    loading = true;
    skeletons();
    el("reportsMessage").hidden = true;
    try {
      const data = await window.NextPulse.api.get("/reports/operations");
      renderKpis(data); renderStockOverview(data.stockOverview); renderProduction(data.production); renderCategories(data.categories); renderOrders(data.orders); renderCritical(data.criticalStock);
      const stamp = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.generatedAt));
      el("reportsUpdated").textContent = `Son güncelleme: ${stamp}`;
      loaded = true;
    } catch (error) {
      el("reportsMessage").className = "np-alert np-alert-error np-reports-alert";
      el("reportsMessage").textContent = error.message || "Raporlar yüklenemedi.";
      el("reportsMessage").hidden = false;
    } finally { loading = false; }
  }

  document.addEventListener("nextpulse:page-change", (event) => { if (event.detail?.page === "reports") load(); });
  document.addEventListener("click", (event) => { if (event.target.closest("#refreshReports")) load(true); });
  return { load };
})();

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
    ["reportsLocations", "reportsCategories", "reportsOrders", "reportsCritical"].forEach((id) => {
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

  function renderLocations(rows) {
    if (!rows.length) { el("reportsLocations").innerHTML = '<div class="np-report-empty">Aktif lokasyon bulunamadı.</div>'; return; }
    el("reportsLocations").innerHTML = rows.map((row) => {
      const ratio = row.totalSkus ? Math.min(100, Math.round(row.stockedSkus * 100 / row.totalSkus)) : 0;
      const mamul = Number(row.finishedGoodUnits) > 0 ? `<b>${number(row.finishedGoodCases)} KOLİ · ${integer(row.finishedGoodUnits)} ADET mamul</b>` : "Mamul stoku yok";
      return `<article class="np-report-location"><div class="np-report-location-title"><strong>${escapeHtml(row.locationName)}</strong><span>${row.stockedSkus} SKU</span></div><div class="np-report-bar" aria-label="Doluluk yüzde ${ratio}"><span style="width:${ratio}%"></span></div><div class="np-report-location-meta"><span>Aktif ürün çeşitliliği %${ratio}</span><span>${mamul}</span></div></article>`;
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
      renderKpis(data); renderLocations(data.locations); renderCategories(data.categories); renderOrders(data.orders); renderCritical(data.criticalStock);
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

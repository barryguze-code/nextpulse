window.NextPulse = window.NextPulse || {};

window.NextPulse.ui = (() => {
  const FAVORITES_KEY = "nextpulse.favoriteModules";
  const SIDEBAR_COLLAPSED_KEY = "nextpulse.sidebarCollapsed";
  const permanentFavoriteKeys = ["home"];
  const defaultFavoriteKeys = ["inventory"];
  let moduleRegistry = new Map();
  let currentPage = "home";
  let dialogResolver = null;
  let dialogPreviousFocus = null;

  function setupSidebar() {
    const app = document.getElementById("npApp");
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebarBackdrop");
    const openButtons = document.querySelectorAll("[data-sidebar-toggle]");
    const closeButtons = document.querySelectorAll("[data-sidebar-close]");
    const collapseButtons = document.querySelectorAll("[data-sidebar-collapse]");

    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true" && !window.matchMedia("(max-width: 991.98px)").matches) {
      app?.classList.add("is-sidebar-collapsed");
      updateCollapseButtons(true);
    }

    window.matchMedia("(max-width: 991.98px)").addEventListener("change", (event) => {
      const shouldCollapse = !event.matches && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
      app?.classList.toggle("is-sidebar-collapsed", shouldCollapse);
      updateCollapseButtons(shouldCollapse);
    });

    const open = () => {
      sidebar?.classList.add("is-open");
      if (backdrop) {
        backdrop.hidden = false;
      }
    };

    const close = () => {
      sidebar?.classList.remove("is-open");
      if (backdrop) {
        backdrop.hidden = true;
      }
    };

    openButtons.forEach((button) => button.addEventListener("click", open));
    closeButtons.forEach((button) => button.addEventListener("click", close));
    collapseButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const isCollapsed = !app?.classList.contains("is-sidebar-collapsed");
        app?.classList.toggle("is-sidebar-collapsed", isCollapsed);
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
        updateCollapseButtons(isCollapsed);
      });
    });
    backdrop?.addEventListener("click", close);

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });
  }

  function updateCollapseButtons(isCollapsed) {
    document.querySelectorAll("[data-sidebar-collapse]").forEach((button) => {
      button.setAttribute("aria-label", isCollapsed ? "Expand navigation" : "Collapse navigation");
      button.setAttribute("title", isCollapsed ? "Expand navigation" : "Collapse navigation");
      const icon = button.querySelector("i");
      if (icon) {
        icon.className = isCollapsed ? "bi bi-layout-sidebar" : "bi bi-layout-sidebar-inset";
      }
    });
  }

  function setupFavorites() {
    moduleRegistry = collectModuleRegistry();
    renderFavorites();

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-favorite-toggle]");

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toggleFavorite(button.dataset.favoriteToggle);
    });
  }

  function collectModuleRegistry() {
    const registry = new Map();

    document.querySelectorAll(".np-nav-item[data-module-key]").forEach((item) => {
      const link = item.querySelector(".np-nav-link");
      const icon = link?.querySelector("i");
      const label = link?.querySelector("span")?.textContent?.trim();
      const key = item.dataset.moduleKey;

      if (!key || !link || !icon || !label) {
        return;
      }

      registry.set(key, {
        iconClass: icon.className,
        label,
        page: link.dataset.page || "",
        pageTitle: link.dataset.pageTitle || label
      });
    });

    return registry;
  }

  function getFavoriteKeys() {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "null");

      if (Array.isArray(stored)) {
        return stored.filter((key) => moduleRegistry.has(key) && !permanentFavoriteKeys.includes(key));
      }
    } catch {
      localStorage.removeItem(FAVORITES_KEY);
    }

    return defaultFavoriteKeys;
  }

  function setFavoriteKeys(keys) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(keys));
  }

  function createNavItem(key, isFavorite) {
    const module = moduleRegistry.get(key);

    if (!module) {
      return null;
    }

    const item = document.createElement("div");
    item.className = permanentFavoriteKeys.includes(key) ? "np-nav-item np-nav-item-static" : "np-nav-item";
    item.dataset.moduleKey = key;

    if (isFavorite) {
      item.dataset.favoriteItem = "";
    }

    const link = document.createElement("a");
    link.className = "np-nav-link";
    link.href = "#";
    link.dataset.pageTitle = module.pageTitle;

    if (module.page) {
      link.dataset.page = module.page;
    }

    link.title = module.label;
    link.innerHTML = `<i class="${module.iconClass}"></i><span>${module.label}</span>`;
    item.appendChild(link);

    if (!permanentFavoriteKeys.includes(key)) {
      const button = document.createElement("button");
      button.className = `np-favorite-button${isFavorite ? " is-favorite" : ""}`;
      button.type = "button";
      button.dataset.favoriteToggle = key;
      button.setAttribute("aria-label", `${isFavorite ? "Remove" : "Add"} ${module.label} ${isFavorite ? "from" : "to"} favorites`);
      button.title = isFavorite ? "Remove from favorites" : "Add to favorites";
      button.innerHTML = `<i class="bi ${isFavorite ? "bi-star-fill" : "bi-star"}"></i>`;
      item.appendChild(button);
    }

    return item;
  }

  function renderFavorites() {
    const favoriteNav = document.getElementById("favoriteNav");
    const moduleNav = document.getElementById("moduleNav");
    const favoriteKeys = getFavoriteKeys();
    const allFavoriteKeys = [...permanentFavoriteKeys, ...favoriteKeys];

    if (favoriteNav) {
      favoriteNav.innerHTML = "";
      allFavoriteKeys.forEach((key) => {
        const item = createNavItem(key, true);
        if (item) {
          favoriteNav.appendChild(item);
        }
      });
    }

    if (moduleNav) {
      moduleNav.querySelectorAll(".np-nav-item[data-module-key]").forEach((item) => {
        item.classList.toggle("is-hidden", favoriteKeys.includes(item.dataset.moduleKey));
      });
    }

    updateActiveNavigation();
  }

  function toggleFavorite(key) {
    if (!key || permanentFavoriteKeys.includes(key)) {
      return;
    }

    const favoriteKeys = getFavoriteKeys();
    const nextKeys = favoriteKeys.includes(key)
      ? favoriteKeys.filter((favoriteKey) => favoriteKey !== key)
      : [...favoriteKeys, key];

    setFavoriteKeys(nextKeys);
    renderFavorites();
  }

  function setupNavigationState() {
    document.addEventListener("click", (event) => {
      const link = event.target.closest("[data-page][data-page-title]");

      if (!link) {
        return;
      }

      const pageTitle = link.dataset.pageTitle;
      const page = link.dataset.page;

      if (link.getAttribute("href") === "#" || page) {
        event.preventDefault();
      }

      if (page) {
        showPage(page, pageTitle);
      }
    });

    showPage("home", "Home");
  }

  function setupMobileOperations() {
    document.addEventListener("click", (event) => {
      const scanButton = event.target.closest("[data-mobile-scan]");

      if (!scanButton) {
        return;
      }

      event.preventDefault();
      showPage("inventory", "Scan Barcode");

      const search = document.getElementById("inventorySearch");
      if (search) {
        search.placeholder = "Scan or enter item barcode";
        search.focus({ preventScroll: true });
        window.setTimeout(() => search.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      }
    });
  }

  function showPage(page, pageTitle) {
    const titleElement = document.getElementById("pageTitle");
    currentPage = page;

    document.getElementById("sidebar")?.classList.remove("is-open");
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) backdrop.hidden = true;

    document.querySelectorAll("[data-page-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.pagePanel !== page;
    });

    updateActiveNavigation();

    if (titleElement && pageTitle) {
      titleElement.textContent = pageTitle;
    }

    document.dispatchEvent(new CustomEvent("nextpulse:page-change", {
      detail: {
        page
      }
    }));
  }

  function updateActiveNavigation() {
    document.querySelectorAll(".np-nav-link").forEach((item) => {
      item.classList.toggle("active", item.dataset.page === currentPage);
    });
    document.querySelectorAll(".np-mobile-bottom-nav [data-page]").forEach((item) => {
      item.classList.toggle("active", item.dataset.page === currentPage);
    });
  }

  function setupHealthCheck() {
    const statusElement = document.getElementById("apiStatus");
    const refreshButton = document.getElementById("refreshHealth");

    const refresh = async () => {
      if (!statusElement) {
        return;
      }

      statusElement.textContent = "Checking";
      try {
        const health = await window.NextPulse.api.get("/health");
        statusElement.textContent = health.status === "UP" ? "Connected" : "Unknown";
      } catch {
        statusElement.textContent = "Offline";
      }
    };

    refreshButton?.addEventListener("click", refresh);
    refresh();
  }

  function setupLogout() {
    const logoutButton = document.getElementById("logoutButton");
    logoutButton?.addEventListener("click", () => {
      window.NextPulse.auth.logout();
    });
  }

  function closeDialog(result) {
    const layer = document.getElementById("npDialogLayer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    layer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("has-np-dialog");
    dialogPreviousFocus?.focus?.();
    const resolve = dialogResolver;
    dialogResolver = null;
    dialogPreviousFocus = null;
    resolve?.(result);
  }

  function setupDialog() {
    document.getElementById("npDialogCancel")?.addEventListener("click", () => closeDialog(false));
    document.getElementById("npDialogConfirm")?.addEventListener("click", () => closeDialog(true));
    document.getElementById("npDialogLayer")?.addEventListener("click", (event) => {
      if (event.target.id === "npDialogLayer") closeDialog(false);
    });
    document.addEventListener("keydown", (event) => {
      const layer = document.getElementById("npDialogLayer");
      if (!layer || layer.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(false);
      }
      if (event.key === "Tab") {
        const buttons = [document.getElementById("npDialogCancel"), document.getElementById("npDialogConfirm")].filter(Boolean);
        const index = buttons.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          buttons.at(-1)?.focus();
        } else if (!event.shiftKey && index === buttons.length - 1) {
          event.preventDefault();
          buttons[0]?.focus();
        }
      }
    });
  }

  function confirmAction({
    type = "warning",
    kicker = "Please confirm",
    title = "Are you sure?",
    message = "This action needs confirmation.",
    detail = "",
    confirmLabel = "Continue",
    cancelLabel = "Go back"
  } = {}) {
    const layer = document.getElementById("npDialogLayer");
    if (!layer) return Promise.resolve(false);
    if (dialogResolver) closeDialog(false);

    const iconMap = {
      danger: "bi bi-trash3-fill",
      warning: "bi bi-exclamation-triangle-fill",
      info: "bi bi-info-circle-fill",
      success: "bi bi-check-circle-fill"
    };
    const icon = document.querySelector("#npDialogIcon i");
    const detailElement = document.getElementById("npDialogDetail");
    const confirmButton = document.getElementById("npDialogConfirm");
    document.getElementById("npDialogKicker").textContent = kicker;
    document.getElementById("npDialogTitle").textContent = title;
    document.getElementById("npDialogMessage").textContent = message;
    document.getElementById("npDialogCancel").textContent = cancelLabel;
    confirmButton.textContent = confirmLabel;
    confirmButton.className = `np-dialog-confirm is-${type}`;
    document.getElementById("npDialogIcon").className = `np-dialog-icon is-${type}`;
    if (icon) icon.className = iconMap[type] || iconMap.warning;
    detailElement.textContent = detail;
    detailElement.hidden = !detail;

    dialogPreviousFocus = document.activeElement;
    layer.hidden = false;
    layer.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-np-dialog");
    window.setTimeout(() => document.getElementById("npDialogCancel")?.focus(), 0);
    return new Promise((resolve) => { dialogResolver = resolve; });
  }

  function init() {
    setupFavorites();
    setupSidebar();
    setupNavigationState();
    setupMobileOperations();
    setupHealthCheck();
    setupLogout();
    setupDialog();
  }

  return {
    init,
    showPage,
    confirmAction
  };
})();

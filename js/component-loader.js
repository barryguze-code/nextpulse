window.NextPulse = window.NextPulse || {};

window.NextPulse.ComponentLoader = (() => {
  async function loadComponent(element) {
    const name = element.dataset.component;
    const response = await fetch(`components/${name}.html`, {
      cache: "no-cache"
    });

    if (!response.ok) {
      throw new Error(`Unable to load component: ${name}`);
    }

    element.outerHTML = await response.text();
  }

  async function loadAll() {
    const targets = Array.from(document.querySelectorAll("[data-component]"));
    await Promise.all(targets.map(loadComponent));
    document.dispatchEvent(new CustomEvent("nextpulse:components-ready"));
  }

  return {
    loadAll
  };
})();

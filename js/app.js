document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("is-loading");

  try {
    const user = await window.NextPulse.auth.requireUser();
    if (!user) {
      return;
    }

    await window.NextPulse.ComponentLoader.loadAll();
    window.NextPulse.ui.init();
    window.NextPulse.inventory?.init();
    window.NextPulse.receiving?.init();
    window.NextPulse.production?.init();
    window.NextPulse.transfer?.init();
    window.NextPulse.auth.hydrateUser(user);
  } finally {
    document.body.classList.remove("is-loading");
  }
});

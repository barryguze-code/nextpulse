document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const button = document.getElementById("loginButton");
  const error = document.getElementById("loginError");
  const apiBaseUrl = window.NextPulse?.config?.apiBaseUrl || loginApiBaseUrl();

  function loginApiBaseUrl() {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.hostname || "localhost";
    const isLocal = host === "localhost" || host === "127.0.0.1";

    if (isLocal) {
      return `${protocol}//${host}:8080/api`;
    }

    return "https://api.nextaicommerce.com/api";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    error.textContent = "";
    button.disabled = true;

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || body.error || "Unable to sign in.");
      }

      window.location.replace("index.html");
    } catch (exception) {
      error.textContent = exception.message || "Unable to sign in.";
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
});

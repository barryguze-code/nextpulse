window.NextPulse = window.NextPulse || {};

function nextPulseApiBaseUrl() {
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const host = window.location.hostname || "localhost";
  const isLocal = host === "localhost" || host === "127.0.0.1";

  if (isLocal) {
    return `${protocol}//${host}:8080/api`;
  }

  return "https://api.nextaicommerce.com/api";
}

window.NextPulse.config = {
  apiBaseUrl: nextPulseApiBaseUrl()
};

window.NextPulse.api = (() => {
  async function request(path, options = {}) {
    const response = await fetch(`${window.NextPulse.config.apiBaseUrl}${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = body?.message || body?.error || "Request failed";
      throw new Error(message);
    }

    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, data) => request(path, {
      method: "POST",
      body: JSON.stringify(data)
    }),
    postEmpty: (path) => request(path, {
      method: "POST"
    })
  };
})();

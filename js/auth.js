window.NextPulse = window.NextPulse || {};

window.NextPulse.auth = (() => {
  async function currentUser() {
    return window.NextPulse.api.get("/auth/me");
  }

  async function requireUser() {
    try {
      return await currentUser();
    } catch {
      window.location.replace("login.html");
      return null;
    }
  }

  async function login(email, password) {
    return window.NextPulse.api.post("/auth/login", {
      email,
      password
    });
  }

  async function logout() {
    try {
      await window.NextPulse.api.postEmpty("/auth/logout");
    } finally {
      window.location.replace("login.html");
    }
  }

  function hydrateUser(user) {
    const nameElement = document.getElementById("userDisplayName");
    const roleElement = document.getElementById("userRole");
    const avatarElement = document.getElementById("userAvatar");

    if (nameElement) {
      nameElement.textContent = user.displayName || "User";
    }

    if (roleElement) {
      roleElement.textContent = Array.isArray(user.roles) && user.roles.length
        ? user.roles[0]
        : "User";
    }

    if (avatarElement) {
      avatarElement.textContent = (user.displayName || user.email || "U").trim().charAt(0).toUpperCase();
    }

    return user;
  }

  return {
    currentUser,
    requireUser,
    login,
    logout,
    hydrateUser
  };
})();

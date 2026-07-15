// Protects the Dashboard: redirects to /login/ if not signed in.
// Also wires the sidebar user row + a logout button.
import { auth, onAuthStateChanged, signOut } from "./firebase.js";

document.documentElement.style.visibility = "hidden";

onAuthStateChanged(auth, (user) => {
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login/?next=${next}`);
    return;
  }

  // Populate sidebar user row
  const nameEl = document.querySelector(".user-name");
  const planEl = document.querySelector(".user-plan");
  const avatarEl = document.querySelector(".user-avatar");
  const display = user.displayName || (user.email ? user.email.split("@")[0] : "User");
  if (nameEl) nameEl.textContent = display;
  if (planEl) planEl.textContent = user.email || "Signed in";
  if (avatarEl) avatarEl.textContent = display.charAt(0).toUpperCase();

  // Inject logout button into sidebar footer
  const footer = document.querySelector(".sidebar-footer");
  if (footer && !document.getElementById("logout-btn")) {
    const btn = document.createElement("button");
    btn.id = "logout-btn";
    btn.type = "button";
    btn.textContent = "Sign out";
    btn.style.cssText =
      "margin-top:10px;width:100%;padding:8px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg-hover);color:var(--text-main);font-weight:600;font-size:12px;cursor:pointer;transition:.15s;";
    btn.addEventListener("mouseenter", () => (btn.style.background = "var(--bg-raised)"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "var(--bg-hover)"));
    btn.addEventListener("click", async () => {
      await signOut(auth);
      location.replace("/home/");
    });
    footer.appendChild(btn);
  }

  document.documentElement.style.visibility = "visible";
});

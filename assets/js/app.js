/* Rosée Skin Atelier: site behaviour
   - mobile menu, plan selection, booking form (validation, submit, offline queue)
   - service worker registration and install prompt
   No third-party scripts, no tracking. */
(function () {
  "use strict";

  var PENDING_KEY = "rosee:pending-request";
  var MESSAGE_MAX = 600;

  /* ---------- small helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function contactEmail() {
    var link = $('a[href^="mailto:"]');
    return link ? link.getAttribute("href").replace("mailto:", "") : "";
  }

  /* ---------- year ---------- */
  var yearEl = $("#year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- header ---------- */
  var header = $(".site-header");
  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var toggle = $(".menu-toggle");
  var nav = $("#site-nav");
  function setMenu(open) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close" : "Menu";
    nav.classList.toggle("is-open", open);
  }
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    $all("a", nav).forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  /* ---------- booking form ---------- */
  var form = $("#booking-form");
  if (!form) return;

  var success = $("#form-success");
  var statusEl = $("#form-status");
  var submitBtn = $(".btn-submit", form);
  var planSelect = $("#f-plan");
  var message = $("#f-message");
  var counter = $("#message-count");
  var startedAt = Date.now();

  // Plan buttons pre-select the consultation and take you to the form
  $all(".choose-plan").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var plan = btn.getAttribute("data-plan");
      if (planSelect && plan) planSelect.value = plan;
      clearError("plan");
      var book = $("#book");
      if (book) book.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      var nameInput = $("#f-name");
      window.setTimeout(function () {
        (nameInput && !nameInput.value ? nameInput : planSelect).focus({ preventScroll: true });
      }, prefersReducedMotion() ? 0 : 500);
    });
  });

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Character counter
  function updateCount() {
    if (counter && message) counter.textContent = message.value.length + " / " + MESSAGE_MAX;
  }
  if (message) message.addEventListener("input", updateCount);
  updateCount();

  // Errors
  function showError(field, text) {
    var input = form.elements[field];
    var el = $("#err-" + field);
    if (input && input.setAttribute) {
      input.setAttribute("aria-invalid", "true");
      if (el) input.setAttribute("aria-describedby", "err-" + field);
    }
    if (el) { el.textContent = text; el.hidden = false; }
  }
  function clearError(field) {
    var input = form.elements[field];
    var el = $("#err-" + field);
    if (input && input.removeAttribute) {
      input.removeAttribute("aria-invalid");
      if (field !== "message") input.removeAttribute("aria-describedby");
    }
    if (el) { el.textContent = ""; el.hidden = true; }
  }
  ["name", "email", "phone", "plan", "consent"].forEach(function (f) {
    var input = form.elements[f];
    if (input) input.addEventListener("input", function () { clearError(f); });
    if (input) input.addEventListener("change", function () { clearError(f); });
  });

  function setStatus(text, isError) {
    if (!statusEl) return;
    if (!text) { statusEl.hidden = true; statusEl.textContent = ""; return; }
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", !!isError);
    statusEl.hidden = false;
  }

  function collect() {
    var data = new FormData(form);
    return {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      plan: String(data.get("plan") || ""),
      format: String(data.get("format") || "studio"),
      days: data.getAll("days").map(String),
      times: data.getAll("times").map(String),
      message: String(data.get("message") || "").trim().slice(0, MESSAGE_MAX),
      consent: !!form.elements.consent.checked,
      website: String(data.get("website") || ""),
      startedAt: startedAt
    };
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var PHONE_RE = /^[0-9 +()\-]{6,20}$/;

  function validate(p) {
    var errors = {};
    if (p.name.length < 2) errors.name = "Add your name so I know who to reply to.";
    if (!p.email) errors.email = "Add your email so I can reply.";
    else if (!EMAIL_RE.test(p.email)) errors.email = "Check your email address. It looks incomplete.";
    if (p.phone && !PHONE_RE.test(p.phone)) errors.phone = "Use digits, spaces, brackets or + only.";
    if (!p.plan) errors.plan = "Choose a consultation, or pick “I’m not sure yet”.";
    if (!p.consent) errors.consent = "Tick this box so I can use your details to arrange your consultation.";
    return errors;
  }

  function showSuccess(name) {
    var first = (name || "").split(/\s+/)[0];
    var nameSlot = $("#success-name");
    if (nameSlot) nameSlot.textContent = first ? ", " + first : "";
    form.hidden = true;
    success.hidden = false;
    success.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    success.focus({ preventScroll: true });
  }

  function resetForm() {
    form.reset();
    startedAt = Date.now();
    updateCount();
    setStatus("");
    success.hidden = true;
    form.hidden = false;
    var nameInput = $("#f-name");
    if (nameInput) nameInput.focus();
  }
  var again = $("#send-another");
  if (again) again.addEventListener("click", resetForm);

  function isPreview() {
    return window.location.protocol === "file:" || document.documentElement.hasAttribute("data-preview");
  }

  function send(payload) {
    return fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { status: res.status, ok: res.ok, body: body };
      });
    });
  }

  function handleResult(result, payload) {
    var email = contactEmail();
    if (result.ok) {
      storageRemove(PENDING_KEY);
      showSuccess(payload.name);
      return;
    }
    if (result.status === 400 && result.body && result.body.fields) {
      Object.keys(result.body.fields).forEach(function (f) { showError(f, result.body.fields[f]); });
      setStatus("A few details need another look.", true);
      return;
    }
    if (result.status === 429) {
      setStatus("Too many requests from this connection. Wait a few minutes and try again" + (email ? ", or email me at " + email + "." : "."), true);
      return;
    }
    if (result.status === 503 || result.status === 404) {
      setStatus("Online booking isn’t switched on yet" + (email ? ". Email me at " + email + " and I’ll reply personally." : "."), true);
      return;
    }
    setStatus("Your request didn’t send. Check your connection and try again" + (email ? ", or email me at " + email + "." : "."), true);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    setStatus("");
    ["name", "email", "phone", "plan", "consent"].forEach(clearError);

    var payload = collect();
    var errors = validate(payload);
    var keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach(function (f) { showError(f, errors[f]); });
      var first = form.elements[keys[0]];
      if (first && first.focus) first.focus();
      return;
    }

    if (isPreview()) {
      setStatus("This is a preview. Booking requests send once the site is deployed.", false);
      return;
    }

    if (!navigator.onLine) {
      var saved = storageSet(PENDING_KEY, JSON.stringify(payload));
      setStatus(saved
        ? "You’re offline. Your request is saved on this device and will send when you’re back online."
        : "You’re offline. Reconnect and send your request again.", !saved);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    send(payload)
      .then(function (result) { handleResult(result, payload); })
      .catch(function () {
        var email = contactEmail();
        setStatus("Your request didn’t send. Check your connection and try again" + (email ? ", or email me at " + email + "." : "."), true);
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send my request";
      });
  });

  // Send a request saved while offline (only once, even if several triggers fire together)
  var flushing = false;
  function flushPending() {
    if (flushing || !navigator.onLine) return;
    var raw = storageGet(PENDING_KEY);
    if (!raw) return;
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { storageRemove(PENDING_KEY); return; }
    flushing = true;
    storageRemove(PENDING_KEY);
    setStatus("You’re back online. Sending your saved request…", false);
    send(payload)
      .then(function (result) {
        if ([500, 502, 504].indexOf(result.status) !== -1) storageSet(PENDING_KEY, raw);
        handleResult(result, payload);
      })
      .catch(function () {
        storageSet(PENDING_KEY, raw);
        setStatus("Your saved request didn’t send yet. It will try again next time you’re online.", true);
      })
      .then(function () { flushing = false; });
  }
  window.addEventListener("online", flushPending);
  if (!isPreview()) flushPending();

  /* ---------- PWA ---------- */
  var canUseSW = "serviceWorker" in navigator && !isPreview() &&
    (window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  if (canUseSW) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () { /* site still works without it */ });
    });
  }

  var deferredPrompt = null;
  var installBtn = $("#install-app");
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        installBtn.hidden = true;
      });
    });
  }
  window.addEventListener("appinstalled", function () {
    if (installBtn) installBtn.hidden = true;
  });
})();

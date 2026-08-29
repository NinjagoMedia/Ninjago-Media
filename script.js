/* =============================================
   NINJAGO MEDIA — script.js (Re:ANIME restyled)
   ============================================= */

"use strict";

let SHOWS = [];

const $ = id => document.getElementById(id);
const pickBackdrop = val => !val ? "" : Array.isArray(val) ? (val[0] || "") : val;

function lockScroll()   { document.body.style.overflow = "hidden"; }
function unlockScroll() { document.body.style.overflow = ""; }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function addKeyboardActivation(el, handler) {
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler(e);
    }
  });
}

function starsHtml(rating, total = 5) {
  let h = "";
  for (let i = 1; i <= total; i++)
    h += `<span class="${i <= rating ? "s-lit" : "s-dim"}">★</span>`;
  return h;
}

/* =============================================
   IMAGE LOADING (shimmer placeholder)
   ============================================= */
// `load`/`error` don't bubble, but capture-phase listeners on document still
// see them since capture runs root -> target regardless of bubbling.
document.addEventListener("load", e => {
  const img = e.target;
  if (img.tagName !== "IMG") return;
  const wrap = img.closest(".card-img-wrap, .cw-thumb, .series-card");
  if (wrap) wrap.classList.add("img-loaded");
}, true);
document.addEventListener("error", e => {
  const img = e.target;
  if (img.tagName !== "IMG") return;
  const wrap = img.closest(".card-img-wrap, .cw-thumb, .series-card");
  if (wrap) wrap.classList.add("img-loaded"); // stop shimmering on broken images too
}, true);

/* =============================================
   PERSISTENCE
   ============================================= */
const Storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
};

/* =============================================
   SUPABASE (community star ratings)
   ---------------------------------------------
   1. Create a free project at https://supabase.com
   2. Run the SQL in supabase-schema.sql (included alongside this
      file) in the Supabase SQL editor — creates the table + policies.
   3. Paste your Project URL and anon/public key below (Project
      Settings → API). The anon key is safe to expose client-side —
      it's designed for this.
   Leaving these blank keeps the app fully working on local-only
   ratings, exactly as before.
   ============================================= */
const SUPABASE_URL      = "";  // e.g. "https://xxxxxxxx.supabase.co"
const SUPABASE_ANON_KEY = "";  // e.g. "eyJhbGciOi..."

const supa = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function getVoterId() {
  let id = Storage.get("nm_voter_id", null);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    Storage.set("nm_voter_id", id);
  }
  return id;
}

const Ratings = {
  _key: "nm_ratings",
  _community: {},   // { showId: { avg, votes } } — populated from Supabase
  all()       { return Storage.get(this._key, {}); },
  get(showId) { return this.all()[showId] || { stars: 0, votes: [] }; },
  setStars(showId, stars) {
    const data = this.all();
    if (!data[showId]) data[showId] = { stars: 0, votes: [] };
    data[showId].stars    = stars;
    data[showId].votes[0] = stars;
    Storage.set(this._key, data);
  },

  // Pushes this vote to Supabase (one row per show per browser, upserted
  // on repeat votes) then refreshes the community stats for that show.
  async syncStars(showId, stars) {
    if (!supa) return;
    try {
      await supa.from("show_ratings").upsert(
        { show_id: String(showId), voter_id: getVoterId(), stars },
        { onConflict: "show_id,voter_id" }
      );
      await this.refreshCommunity(showId);
    } catch { /* offline, or Supabase not reachable — local rating still stands */ }
  },

  // Loads aggregated { avg_stars, votes } for every show in one round trip.
  async refreshAllCommunity() {
    if (!supa) return;
    try {
      const { data, error } = await supa.from("show_rating_stats").select("*");
      if (error || !data) return;
      data.forEach(row => {
        this._community[row.show_id] = { avg: parseFloat(row.avg_stars), votes: row.votes };
      });
    } catch { /* offline — fall back to local-only ratings */ }
  },

  async refreshCommunity(showId) {
    if (!supa) return;
    try {
      const { data } = await supa.from("show_rating_stats").select("*").eq("show_id", String(showId)).maybeSingle();
      if (data) this._community[showId] = { avg: parseFloat(data.avg_stars), votes: data.votes };
    } catch {}
  },

  communityNote(showId) {
    if (!supa) return "Rated locally only — connect Supabase to sync with everyone";
    const c = this._community[showId];
    if (!c || !c.votes) return "Be the first to rate this";
    return `${c.avg.toFixed(1)} average from ${c.votes} ${c.votes === 1 ? "vote" : "votes"}`;
  },

  // Community average takes priority once loaded (it reflects every
  // visitor's vote); local-only vote is the fallback before that resolves
  // or when Supabase isn't configured.
  average(showId, officialRating) {
    const community = this._community[showId];
    if (community && community.votes > 0) {
      if (officialRating) return Math.round(((parseFloat(officialRating) * 10 + community.avg * 5) / 15) * 10) / 10;
      return Math.round(community.avg * 10) / 10;
    }
    const { votes = [] } = this.get(showId);
    const valid = votes.filter(v => v > 0);
    if (!valid.length) return officialRating ? parseFloat(officialRating) : null;
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (officialRating) return Math.round(((parseFloat(officialRating) * 10 + avg * 5) / 15) * 10) / 10;
    return Math.round(avg * 10) / 10;
  }
};

const EpProgress = {
  _key: "nm_ep_progress",
  all()  { return Storage.get(this._key, {}); },
  key(showId, season, epIdx) { return `${showId}_${season}_${epIdx}`; },
  get(showId, season, epIdx) { return this.all()[this.key(showId, season, epIdx)] || 0; },
  set(showId, season, epIdx, pct) {
    const data = this.all();
    data[this.key(showId, season, epIdx)] = Math.min(100, Math.max(0, Math.round(pct)));
    Storage.set(this._key, data);
  }
};

const Favorites = {
  _key: "nm_favorites",
  all()               { return new Set(Storage.get(this._key, [])); },
  key(showId, season) { return season ? `${showId}::${season}` : String(showId); },
  has(showId, season) { return this.all().has(this.key(showId, season)); },
  toggle(showId, season) {
    const s = this.all(), k = this.key(showId, season);
    s.has(k) ? s.delete(k) : s.add(k);
    Storage.set(this._key, [...s]);
    return s.has(k);
  },
  entries() {
    return [...this.all()].map(k => {
      const str = String(k);
      const [showId, season] = str.includes("::") ? str.split("::") : [str, null];
      return { showId: parseInt(showId) || showId, season };
    });
  }
};

const Progress = {
  _key: "nm_progress",
  all()  { return Storage.get(this._key, {}); },
  key(showId, season, epIdx) { return `${showId}_${season}_${epIdx}`; },
  save(show, season, epIdx) {
    const ep = show.episodes?.[season]?.[epIdx];
    if (!ep) return;
    const data = this.all();
    data[this.key(show.id, season, epIdx)] = {
      showId: show.id, season, epIdx,
      title: ep.title, showTitle: show.title,
      poster: show.poster, backdrop: pickBackdrop(show.backdrop),
      video: ep.video, ts: Date.now()
    };
    Storage.set(this._key, data);
  },
  remove(showId, season, epIdx) {
    const data = this.all();
    delete data[this.key(showId, season, epIdx)];
    Storage.set(this._key, data);
  },
  recent(limit = 10) {
    const byShow = {};
    for (const e of Object.values(this.all())) {
      if (!byShow[e.showId] || e.ts > byShow[e.showId].ts) byShow[e.showId] = e;
    }
    return Object.values(byShow).sort((a, b) => b.ts - a.ts).slice(0, limit);
  },
  lastForSeason(showId, season) {
    return Object.values(this.all())
      .filter(e => e.showId === showId && e.season === season)
      .sort((a, b) => b.ts - a.ts)[0] || null;
  }
};

/* =============================================
   DATA LOAD
   ============================================= */
fetch("series.json")
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => {
    SHOWS = Array.isArray(data) ? data : (data.shows || []);
    SHOWS.forEach(show => {
      if (!show.episodes) return;
      for (const s of Object.keys(show.episodes)) {
        show.episodes[s] = show.episodes[s].filter(ep => ep?.title);
        if (!show.episodes[s].length) delete show.episodes[s];
      }
    });
    initPage();
  })
  .catch(err => {
    console.error("Error loading show data:", err);
    SHOWS = [];
    initPage();
    showToast("Could not load show data.");
  });

function initPage() {
  buildWatchRow();
  buildSeasonRows();
  buildTrendingRow();
  buildContinueWatchingRow();
  buildWatchlistSection();
  buildSeriesGrid();
  setupHero();
  setupNav();
  setupSearch();
  setupHeaderScroll();
  setupFooterReveal();
  setupKeyboardEsc();
  setupSeriesFilter();
  setupSeriesSort();
  setupSectionTabs();
  setupGlobalInfoButtons();
  setupSurprise();

  // Local ratings render immediately; once Supabase confirms the
  // community numbers, re-render the rating-dependent views with them.
  Ratings.refreshAllCommunity().then(() => {
    buildTrendingRow();
    buildSeriesGrid();
  });
}

/* =============================================
   HEADER SCROLL
   ============================================= */
function setupHeaderScroll() {
  const header = $("site-header");
  window.addEventListener("scroll", () => {
    header.classList.toggle("scrolled", window.scrollY > 40);
  }, { passive: true });
}

/* =============================================
   NAVIGATION
   ============================================= */
function setupNav() {
  $("home-btn").addEventListener("click",   () => showPage("home"));
  $("series-btn").addEventListener("click", () => showPage("series"));
  const logoLink = $("logo-link");
  if (logoLink) logoLink.addEventListener("click", e => { e.preventDefault(); showPage("home"); });
}

function showPage(page) {
  const isHome = page === "home";
  $("page-home").classList.toggle("hidden", !isHome);
  $("page-series").classList.toggle("hidden", isHome);
  $("home-btn").classList.toggle("active", isHome);
  $("series-btn").classList.toggle("active", !isHome);
  window.scrollTo({ top: 0, behavior: "smooth" });
  const el = isHome ? $("page-home") : $("page-series");
  el.style.animation = "none";
  requestAnimationFrame(() => { el.style.animation = ""; });
  if (isHome) { buildTrendingRow(); buildContinueWatchingRow(); buildWatchlistSection(); }
}

/* =============================================
   HELPERS
   ============================================= */
function countEpisodes(show) {
  if (!show.episodes) return 0;
  return Object.values(show.episodes).reduce((sum, eps) => sum + eps.length, 0);
}

function syncFavBtn(btn, active) {
  btn.classList.toggle("fav-active", active);
  btn.title = active ? "Remove from Watchlist" : "Add to Watchlist";
  btn.setAttribute("aria-label", btn.title);
  btn.querySelector("i").className = `fa-${active ? "solid" : "regular"} fa-bookmark text-xs`;
}

function makeCard(s, onClick, onFav, { season = null, poster = null, label = null, status = null } = {}) {
  const card     = document.createElement("div");
  card.className = "show-card";
  const isFav    = Favorites.has(s.id, season);
  const img      = poster || s.poster;
  const title    = label  || s.title;
  const sub      = status || (season ? `${s.episodes?.[season]?.length || 0} Eps` : (s.status || ""));
  const dispRating = s.rating || null;

  card.innerHTML = `
    <div class="card-img-wrap">
      <img src="${img}" alt="${escapeHtml(title)}" class="poster" loading="lazy" />
      <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play text-xs ml-0.5"></i></div></div>
      ${dispRating ? `<div class="card-rating-badge"><i class="fa-solid fa-star" style="font-size:0.52rem"></i>${dispRating}</div>` : ""}
      <button class="card-fav-btn${isFav ? " fav-active" : ""}" title="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}" aria-label="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}">
        <i class="fa-${isFav ? "solid" : "regular"} fa-bookmark text-xs"></i>
      </button>
    </div>
    <div class="card-meta">
      <div class="card-title">${escapeHtml(title)}</div>
      <div class="card-status">${escapeHtml(sub)}</div>
    </div>`;

  card.querySelector(".card-img-wrap").addEventListener("click", e => {
    if (e.target.closest(".card-fav-btn")) return;
    onClick();
  });
  card.querySelector(".card-meta").addEventListener("click", onClick);
  card.querySelector(".card-fav-btn").addEventListener("click", e => {
    e.stopPropagation();
    onFav(e.currentTarget);
  });
  addKeyboardActivation(card, () => onClick());
  return card;
}

/* =============================================
   SECTION TABS (home "All Series" row)
   ============================================= */
let _homeTabFilter = "all";

function setupSectionTabs() {
  document.querySelectorAll(".section-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".section-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _homeTabFilter = btn.dataset.tab;
      buildWatchRow();
    });
  });
}

/* =============================================
   CONTINUE WATCHING ROW
   ============================================= */
function buildContinueWatchingRow() {
  const section = $("continue-watching-section");
  const row     = $("continue-watching-row");
  if (!section || !row) return;
  const recent = Progress.recent(10);
  section.classList.toggle("hidden", !recent.length);
  if (!recent.length) return;

  row.innerHTML = "";
  for (const entry of recent) {
    const show = SHOWS.find(s => s.id === entry.showId);
    if (!show) continue;
    const pct  = EpProgress.get(entry.showId, entry.season, entry.epIdx);
    const card = document.createElement("div");
    card.className = "cw-card";
    card.innerHTML = `
      <div class="cw-thumb">
        <img src="${entry.backdrop || entry.poster}" alt="${escapeHtml(entry.showTitle)}" loading="lazy" />
        <div class="cw-overlay"><div class="cw-play-btn"><i class="fa-solid fa-play text-xs ml-0.5"></i></div></div>
        <button class="cw-remove" title="Remove"><i class="fa-solid fa-xmark text-xs"></i></button>
        <div class="cw-progress-wrap"><div class="cw-progress-bar" style="width:${pct}%"></div></div>
      </div>
      <div class="cw-meta">
        <div class="cw-show">${escapeHtml(entry.showTitle)}</div>
        <div class="cw-ep">${escapeHtml(entry.season)} · Ep ${entry.epIdx + 1}</div>
        <div class="cw-title">${escapeHtml(entry.title)}</div>
      </div>`;
    card.querySelector(".cw-thumb").addEventListener("click", e => {
      if (e.target.closest(".cw-remove")) return;
      playEpisode(show, entry.season, entry.epIdx);
    });
    card.querySelector(".cw-remove").addEventListener("click", e => {
      e.stopPropagation();
      Progress.remove(entry.showId, entry.season, entry.epIdx);
      buildContinueWatchingRow();
    });
    addKeyboardActivation(card, () => playEpisode(show, entry.season, entry.epIdx));
    row.appendChild(card);
  }
}

/* =============================================
   WATCH ROW (home — all series, tabbed)
   ============================================= */
function buildWatchRow() {
  const row = $("row");
  if (!row) return;
  row.innerHTML = "";

  const filtered = SHOWS.filter(s => {
    if (_homeTabFilter === "all") return true;
    return s.status?.toLowerCase() === _homeTabFilter;
  });

  for (const s of filtered) {
    const totalEps = countEpisodes(s);
    const card = makeCard(
      s,
      () => openWatchMenu(s),
      btn => {
        const nowFav = Favorites.toggle(s.id, null);
        syncFavBtn(btn, nowFav);
        showToast(nowFav ? `${s.title} added to Watchlist` : `${s.title} removed`);
        buildSeriesGrid(); buildWatchlistSection();
      },
      { status: `${s.status || ""}${totalEps ? ` · ${totalEps} Eps` : ""}` }
    );
    row.appendChild(card);
  }
}

/* =============================================
   TRENDING NOW ROW (home — ranked by rating)
   ============================================= */
function buildTrendingRow() {
  const section = $("trending-section");
  const row     = $("trending-row");
  if (!section || !row) return;
  if (!SHOWS.length) { section.classList.add("hidden"); return; }

  const ranked = [...SHOWS]
    .map(s => ({ s, score: Ratings.average(s.id, s.rating) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.s);

  section.classList.remove("hidden");
  row.innerHTML = "";
  for (const s of ranked) {
    const totalEps = countEpisodes(s);
    const card = makeCard(
      s,
      () => openWatchMenu(s),
      btn => {
        const nowFav = Favorites.toggle(s.id, null);
        syncFavBtn(btn, nowFav);
        showToast(nowFav ? `${s.title} added to Watchlist` : `${s.title} removed`);
        buildSeriesGrid(); buildWatchlistSection();
      },
      { status: `${s.status || ""}${totalEps ? ` · ${totalEps} Eps` : ""}` }
    );
    row.appendChild(card);
  }
}

/* =============================================
   SEASON ROWS
   ============================================= */
function buildSeasonRows() {
  const container = $("season-rows");
  if (!container) return;
  container.innerHTML = "";

  for (const show of SHOWS) {
    const seasons = Object.keys(show.episodes || {});
    if (seasons.length < 2) continue; // only shows with multiple seasons get a dedicated row

    const section = document.createElement("section");
    section.className = "px-5 md:px-8 pt-6 pb-2";
    const rowId = `season-row-${show.id}`;

    section.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3">
          <span class="accent-bar"></span>
          <h2 class="section-title">${escapeHtml(show.title)}</h2>
        </div>
        <div class="flex gap-1.5 row-nav-btns">
          <button class="row-scroll-btn row-scroll-left" style="display:none" title="Scroll left" aria-label="Scroll left">
            <i class="fa-solid fa-chevron-left text-xs"></i>
          </button>
          <button class="row-scroll-btn row-scroll-right" style="display:none" title="Scroll right" aria-label="Scroll right">
            <i class="fa-solid fa-chevron-right text-xs"></i>
          </button>
        </div>
      </div>
      <div id="${rowId}" class="card-row flex gap-3 overflow-x-auto pb-3"></div>`;

    const rowEl    = section.querySelector(`#${rowId}`);
    const btnLeft  = section.querySelector(".row-scroll-left");
    const btnRight = section.querySelector(".row-scroll-right");
    const getCardW = () => (rowEl.firstElementChild?.offsetWidth || 130) + 12;

    const updateBtns = () => {
      const overflows = rowEl.scrollWidth > rowEl.clientWidth + 4;
      const atStart   = rowEl.scrollLeft <= 2;
      const atEnd     = rowEl.scrollLeft >= rowEl.scrollWidth - rowEl.clientWidth - 2;
      btnLeft.style.display  = overflows && !atStart ? "" : "none";
      btnRight.style.display = overflows && !atEnd   ? "" : "none";
    };

    btnLeft.addEventListener("click",  () => rowEl.scrollTo({ left: Math.max(0, rowEl.scrollLeft - getCardW() * 3), behavior: "smooth" }));
    btnRight.addEventListener("click", () => rowEl.scrollTo({ left: Math.min(rowEl.scrollWidth - rowEl.clientWidth, rowEl.scrollLeft + getCardW() * 3), behavior: "smooth" }));
    rowEl.addEventListener("scroll", updateBtns, { passive: true });
    window.addEventListener("resize", updateBtns, { passive: true });
    requestAnimationFrame(updateBtns);

    for (const season of seasons) {
      const eps    = show.episodes[season] || [];
      const poster = show.seasonPosters?.[season] || show.poster;
      const isFav  = Favorites.has(show.id, season);

      const card = document.createElement("div");
      card.className = "show-card";
      card.innerHTML = `
        <div class="card-img-wrap">
          <img src="${poster}" alt="${escapeHtml(season)}" class="poster" loading="lazy" />
          <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play text-xs ml-0.5"></i></div></div>
          <button class="card-fav-btn${isFav ? " fav-active" : ""}" title="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}" aria-label="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}">
            <i class="fa-${isFav ? "solid" : "regular"} fa-bookmark text-xs"></i>
          </button>
        </div>
        <div class="card-meta">
          <div class="card-title">${escapeHtml(season)}</div>
          <div class="card-status">${eps.length} Ep${eps.length !== 1 ? "s" : ""}</div>
        </div>`;

      card.querySelector(".card-img-wrap").addEventListener("click", e => {
        if (e.target.closest(".card-fav-btn")) return;
        openWatchMenu(show, season);
      });
      card.querySelector(".card-meta").addEventListener("click", () => openWatchMenu(show, season));
      card.querySelector(".card-fav-btn").addEventListener("click", e => {
        e.stopPropagation();
        const nowFav = Favorites.toggle(show.id, season);
        syncFavBtn(e.currentTarget, nowFav);
        showToast(nowFav ? `${season} added to Watchlist` : `${season} removed`);
        buildWatchlistSection();
      });
      addKeyboardActivation(card, () => openWatchMenu(show, season));
      rowEl.appendChild(card);
    }

    rowEl.querySelectorAll("img").forEach(img => img.addEventListener("load", updateBtns, { once: true }));
    container.appendChild(section);
  }
}

/* =============================================
   WATCHLIST SECTION
   ============================================= */
function buildWatchlistSection() {
  const section = $("watchlist-section");
  const row     = $("watchlist-row");
  if (!section || !row) return;
  const entries = Favorites.entries();
  section.classList.toggle("hidden", !entries.length);
  if (!entries.length) return;

  row.innerHTML = "";
  for (const { showId, season } of entries) {
    const show = SHOWS.find(s => s.id === showId);
    if (!show) continue;
    const poster  = season ? (show.seasonPosters?.[season] || show.poster) : show.poster;
    const label   = season || show.title;
    const subline = season ? `${show.title} · ${show.episodes?.[season]?.length || 0} Eps` : (show.status || "");

    const card = document.createElement("div");
    card.className = "show-card";
    card.innerHTML = `
      <div class="card-img-wrap">
        <img src="${poster}" alt="${escapeHtml(label)}" class="poster" loading="lazy" />
        <div class="card-overlay"><div class="card-play-btn"><i class="fa-solid fa-play text-xs ml-0.5"></i></div></div>
        <button class="card-fav-btn fav-active" title="Remove from Watchlist" aria-label="Remove from Watchlist">
          <i class="fa-solid fa-bookmark text-xs"></i>
        </button>
      </div>
      <div class="card-meta">
        <div class="card-title">${escapeHtml(label)}</div>
        <div class="card-status">${escapeHtml(subline)}</div>
      </div>`;
    card.querySelector(".card-img-wrap").addEventListener("click", e => {
      if (e.target.closest(".card-fav-btn")) return;
      openWatchMenu(show, season);
    });
    card.querySelector(".card-meta").addEventListener("click", () => openWatchMenu(show, season));
    card.querySelector(".card-fav-btn").addEventListener("click", e => {
      e.stopPropagation();
      Favorites.toggle(showId, season);
      buildWatchlistSection(); buildSeriesGrid(); buildSeasonRows();
      showToast(`${label} removed from Watchlist`);
    });
    addKeyboardActivation(card, () => openWatchMenu(show, season));
    row.appendChild(card);
  }
}

/* =============================================
   SERIES GRID
   ============================================= */
let _seriesFilter = "all";
let _seriesSort   = "rating";

function setupSeriesFilter() {
  document.querySelectorAll(".series-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".series-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _seriesFilter = btn.dataset.filter;
      buildSeriesGrid();
    });
  });
}

function setupSeriesSort() {
  const sel = $("series-sort");
  if (!sel) return;
  sel.value = _seriesSort;
  sel.addEventListener("change", () => {
    _seriesSort = sel.value;
    buildSeriesGrid();
  });
}

function buildSeriesGrid() {
  const grid = $("series-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const filtered = SHOWS.filter(s => {
    if (_seriesFilter === "all") return true;
    return s.status?.toLowerCase() === _seriesFilter;
  });

  const sorted = filtered.sort((a, b) => {
    if (_seriesSort === "az") return a.title.localeCompare(b.title);
    if (_seriesSort === "za") return b.title.localeCompare(a.title);
    const ra = Ratings.average(a.id, a.rating) ?? 0;
    const rb = Ratings.average(b.id, b.rating) ?? 0;
    return rb - ra;
  });

  for (const s of sorted) {
    const globalIdx   = SHOWS.indexOf(s);
    const card        = document.createElement("div");
    card.className    = "series-card";
    const seasonCount = s.episodes ? Object.keys(s.episodes).length : 0;
    const isFav       = Favorites.has(s.id, null);
    const isOngoing   = s.status?.toLowerCase() === "ongoing";
    const userStars   = Ratings.get(s.id).stars;

    card.innerHTML = `
      <img src="${s.poster}" alt="${escapeHtml(s.title)}" loading="lazy" />
      <div class="series-card-overlay">
        <div class="series-card-title">${escapeHtml(s.title)}</div>
        <div class="series-card-meta">
          <span class="series-card-rating"><i class="fa-solid fa-star" style="font-size:0.58rem"></i>${s.rating || "N/A"}</span>
          <span class="series-card-status">
            <span class="status-dot ${isOngoing ? "ongoing" : "complete"}"></span>${s.status || ""}
          </span>
          ${seasonCount > 1 ? `<span class="series-card-status">${seasonCount} seasons</span>` : ""}
        </div>
      </div>
      ${s.rating ? `<div class="series-rating-badge"><i class="fa-solid fa-star" style="font-size:0.52rem"></i>${s.rating}</div>` : ""}
      ${userStars ? `<div class="series-card-user-rating"><div class="stars-display">${starsHtml(userStars)}</div></div>` : ""}
      <button class="series-fav-btn${isFav ? " fav-active" : ""}" title="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}" aria-label="${isFav ? "Remove from Watchlist" : "Add to Watchlist"}">
        <i class="fa-${isFav ? "solid" : "regular"} fa-bookmark text-xs"></i>
      </button>`;

    card.addEventListener("click", e => {
      if (e.target.closest(".series-fav-btn")) return;
      openModal(globalIdx);
    });
    card.querySelector(".series-fav-btn").addEventListener("click", e => {
      e.stopPropagation();
      const nowFav = Favorites.toggle(s.id, null);
      const btn = e.currentTarget;
      btn.classList.toggle("fav-active", nowFav);
      btn.title = nowFav ? "Remove from Watchlist" : "Add to Watchlist";
      btn.setAttribute("aria-label", btn.title);
      btn.querySelector("i").className = `fa-${nowFav ? "solid" : "regular"} fa-bookmark text-xs`;
      showToast(nowFav ? `${s.title} added to Watchlist` : `${s.title} removed`);
      buildWatchRow(); buildWatchlistSection();
    });
    addKeyboardActivation(card, () => openModal(globalIdx));
    grid.appendChild(card);
  }
}

/* =============================================
   HERO SLIDESHOW
   ============================================= */
let currentSlide = 0, heroInterval = null;

function setupHero() {
  if (!SHOWS.length) return;
  buildHeroIndicators();
  updateHero(0, true);
  startHeroInterval();
}

function buildHeroIndicators() {
  const wrap = $("hero-indicators");
  if (!wrap) return;
  wrap.innerHTML = "";
  SHOWS.forEach((_, i) => {
    const dot = document.createElement("button");
    dot.className = `hero-dot${i === 0 ? " active" : ""}`;
    dot.setAttribute("aria-label", `Show ${i + 1}`);
    dot.addEventListener("click", () => {
      stopHeroInterval(); currentSlide = i; updateHero(i); startHeroInterval();
    });
    wrap.appendChild(dot);
  });
}

function startHeroInterval() {
  stopHeroInterval();
  if (document.hidden) return; // don't tick while tab is backgrounded
  heroInterval = setInterval(() => {
    currentSlide = (currentSlide + 1) % SHOWS.length;
    updateHero(currentSlide);
  }, 7000);
}
function stopHeroInterval() {
  if (heroInterval) { clearInterval(heroInterval); heroInterval = null; }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopHeroInterval();
  else if (SHOWS.length) startHeroInterval();
});

function updateHero(index, immediate = false) {
  const s       = SHOWS[index];
  if (!s) return;
  const hero    = $("hero");
  const heroBg  = $("hero-bg");
  const meta    = $("hero-meta");
  const titleEl = $("hero-title");
  const descEl  = $("hero-desc");
  const playBtn = $("hero-play");
  const infoBtn = hero.querySelector(".more-info-btn");
  const backdrop = pickBackdrop(s.backdrop);
  const totalEps = countEpisodes(s);

  const apply = () => {
    if (backdrop && heroBg) heroBg.style.backgroundImage = `url('${backdrop}')`;
    meta.innerHTML = `
      ${s.rating ? `<span class="hero-rating"><i class="fa-solid fa-star" style="font-size:0.62rem"></i>${s.rating}</span>` : ""}
      <span class="hero-badge">${s.status || ""}</span>
      ${totalEps ? `<span class="hero-ep-count">${totalEps} Episodes</span>` : ""}`;
    titleEl.textContent = s.title || "";
    descEl.textContent  = s.description
      ? (s.description.length > 160 ? s.description.slice(0, 160) + "…" : s.description) : "";
    playBtn.onclick = () => openWatchMenu(s);
    if (infoBtn) infoBtn.dataset.index = index;
    hero.style.opacity = "1";
  };

  if (immediate) { hero.style.transition = "none"; apply(); }
  else { hero.style.opacity = "0"; hero.style.transition = "opacity 0.4s ease"; setTimeout(apply, 180); }
  document.querySelectorAll(".hero-dot").forEach((d, i) => d.classList.toggle("active", i === index));
}

/* =============================================
   INFO MODAL
   ============================================= */
const modalEl         = $("modal");
const modalContent    = $("modal-content");
const modalBackImg    = $("modal-backdrop-image");
const modalPoster     = $("modal-poster");
const modalTitle      = $("modal-title");
const modalMetaRow    = $("modal-meta-row");
const modalDesc       = $("modal-desc");
const modalCast       = $("modal-cast");
const modalTrailerBtn = $("modal-trailer-btn");
const modalWatchBtn   = $("modal-watch-btn");
const modalClose      = $("modal-close");
const modalBgClick    = $("modal-backdrop-click");
const modalFavBtn     = $("modal-fav-btn");
const modalStarRating = $("modal-star-rating");

function renderStarRating(showId) {
  if (!modalStarRating) return;
  const data  = Ratings.get(showId);
  let current = data.stars || 0;
  modalStarRating.innerHTML = "";

  const noteEl = $("modal-rating-note");
  if (noteEl) noteEl.textContent = Ratings.communityNote(showId);

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement("span");
    star.className   = "star";
    star.textContent = "★";
    star.style.color = i <= current ? "var(--gold)" : "";
    const highlight = n => {
      modalStarRating.querySelectorAll(".star").forEach((s, j) => { s.style.color = j < n ? "var(--gold)" : ""; });
    };
    star.addEventListener("mouseenter", () => highlight(i));
    star.addEventListener("mouseleave", () => highlight(current));
    star.addEventListener("click", () => {
      current = i;
      Ratings.setStars(showId, i);
      highlight(i);

      const refresh = () => {
        const scoreEl = modalMetaRow?.querySelector(".modal-score");
        if (scoreEl) {
          const show = SHOWS.find(s => s.id === showId);
          const avg  = Ratings.average(showId, show?.rating);
          if (avg !== null) scoreEl.innerHTML = `<i class="fa-solid fa-star" style="font-size:0.58rem"></i>${avg}`;
        }
        if (noteEl) noteEl.textContent = Ratings.communityNote(showId);
        buildSeriesGrid();
        buildTrendingRow();
      };
      refresh();
      Ratings.syncStars(showId, i).then(refresh);
    });
    modalStarRating.appendChild(star);
  }
}

function openModal(index) {
  const s = SHOWS[index];
  if (!s) return;
  const totalEps  = countEpisodes(s);
  const isFav     = Favorites.has(s.id, null);
  const isOngoing = s.status?.toLowerCase() === "ongoing";
  const avgRating = Ratings.average(s.id, s.rating);

  modalPoster.src = s.poster || "";
  modalBackImg.style.backgroundImage = `url('${pickBackdrop(s.backdrop)}')`;
  modalTitle.textContent = s.title || "";
  modalDesc.textContent  = s.description || "";
  modalCast.textContent  = s.cast?.length ? `Cast: ${s.cast.join(" · ")}` : "";

  modalMetaRow.innerHTML = `
    ${avgRating !== null ? `<span class="modal-score"><i class="fa-solid fa-star" style="font-size:0.58rem"></i>${avgRating}</span>` : ""}
    <span class="modal-pill ${isOngoing ? "ongoing" : ""}">${s.status || ""}</span>
    ${totalEps ? `<span class="modal-pill">${totalEps} Eps</span>` : ""}`;

  if (s.trailer) {
    modalTrailerBtn.classList.remove("hidden");
    modalTrailerBtn.onclick = () => openTrailer(s);
  } else {
    modalTrailerBtn.classList.add("hidden");
  }
  modalWatchBtn.onclick = () => { closeModal(); openWatchMenu(s); };

  if (modalFavBtn) {
    const refreshFavBtn = active => {
      modalFavBtn.classList.toggle("fav-active", active);
      modalFavBtn.innerHTML = `<i class="fa-${active ? "solid" : "regular"} fa-bookmark mr-2 text-xs"></i>${active ? "Saved" : "Watchlist"}`;
    };
    refreshFavBtn(isFav);
    modalFavBtn.onclick = () => {
      const nowFav = Favorites.toggle(s.id, null);
      refreshFavBtn(nowFav);
      showToast(nowFav ? `${s.title} added to Watchlist` : `${s.title} removed`);
      buildWatchRow(); buildSeriesGrid(); buildWatchlistSection();
    };
  }

  renderStarRating(s.id);
  modalEl.classList.remove("hidden");
  lockScroll();
  requestAnimationFrame(() => modalContent.classList.add("open"));
}

function closeModal() {
  modalContent.classList.remove("open");
  setTimeout(() => { modalEl.classList.add("hidden"); unlockScroll(); }, 240);
}

modalBgClick.addEventListener("click", closeModal);
modalClose.addEventListener("click",   closeModal);

/* =============================================
   GLOBAL INFO BUTTON
   ============================================= */
function setupGlobalInfoButtons() {
  document.addEventListener("click", e => {
    const infoBtn = e.target.closest(".more-info-btn");
    if (!infoBtn) return;
    const idx = parseInt(infoBtn.dataset.index);
    if (!isNaN(idx)) openModal(idx);
  });
}

/* =============================================
   TRAILER MODAL
   ============================================= */
const trailerModal = $("trailer-modal");
const trailerFrame = $("trailer-frame");
const trailerClose = $("trailer-close");

function openTrailer(show) {
  if (!show?.trailer) return showToast("Trailer not available");
  trailerFrame.src = show.trailer + (show.trailer.includes("?") ? "&autoplay=1" : "?autoplay=1");
  trailerModal.classList.remove("hidden");
  lockScroll();
}
function closeTrailer() {
  trailerModal.classList.add("hidden");
  trailerFrame.src = "";
  unlockScroll();
}
trailerClose.addEventListener("click", closeTrailer);
trailerModal.addEventListener("click", e => { if (e.target === trailerModal) closeTrailer(); });

/* =============================================
   WATCH MENU
   ============================================= */
const watchModal    = $("watch-modal");
const watchInner    = $("watch-inner");
const watchBackdrop = $("watch-backdrop");
const watchTitle    = $("watch-title");
const watchRating   = $("watch-rating");
const seasonSelect  = $("season-select");
const episodesList  = $("episodes-list");
const watchClose    = $("watch-close");
const watchPoster   = $("watch-poster");

let currentShow = null;

function updateWatchPoster(show, season) {
  watchPoster.style.opacity = "0";
  setTimeout(() => {
    watchPoster.src = (season && show.seasonPosters?.[season]) || show.poster || "";
    watchPoster.style.opacity = "1";
  }, 150);
}

function openWatchMenu(show, targetSeason = null) {
  if (!show) return;
  currentShow = show;
  watchTitle.textContent  = show.title || "";
  watchRating.textContent = `⭐ ${show.rating || "N/A"} · ${show.status || ""}`;
  watchBackdrop.style.backgroundImage = `url('${pickBackdrop(show.backdrop)}')`;

  const seasons = Object.keys(show.episodes || {});
  if (!seasons.length) {
    episodesList.innerHTML = `<div class="col-span-full p-4 text-gray-500 text-sm">No episodes available yet.</div>`;
    seasonSelect.innerHTML = "";
    watchPoster.src = show.poster || "";
  } else {
    seasonSelect.innerHTML = seasons.map(s => `<option value="${s}">${escapeHtml(s)}</option>`).join("");
    seasonSelect.onchange = e => {
      loadEpisodes(show, e.target.value);
      updateWatchPoster(show, e.target.value);
    };
    let jumpTo = targetSeason && seasons.includes(targetSeason) ? targetSeason : null;
    if (!jumpTo) {
      const last = Object.values(Progress.all())
        .filter(e => e.showId === show.id)
        .sort((a, b) => b.ts - a.ts)[0];
      jumpTo = (last && seasons.includes(last.season)) ? last.season : seasons[0];
    }
    seasonSelect.value = jumpTo;
    updateWatchPoster(show, jumpTo);
    loadEpisodes(show, jumpTo);
  }

  watchModal.classList.remove("hidden");
  lockScroll();
  requestAnimationFrame(() => watchInner.classList.add("open"));
}

function closeWatchMenu() {
  watchInner.classList.remove("open");
  safeVideoPause();
  setTimeout(() => { watchModal.classList.add("hidden"); unlockScroll(); currentShow = null; }, 240);
}

watchClose.addEventListener("click", closeWatchMenu);
watchModal.addEventListener("click", e => { if (e.target === watchModal) closeWatchMenu(); });

function loadEpisodes(show, season) {
  const eps = show.episodes?.[season] || [];
  if (!episodesList) return;
  if (!eps.length) {
    episodesList.innerHTML = `<div class="col-span-full p-4 text-gray-500 text-sm">No episodes found.</div>`;
    return;
  }

  const lastWatched = Progress.lastForSeason(show.id, season);

  episodesList.innerHTML = eps.map((ep, i) => {
    const safeTitle = ep.title || `Episode ${i + 1}`;
    const hasVideo  = !!(ep.video?.trim());
    const isResume  = lastWatched?.epIdx === i;
    const pct       = EpProgress.get(show.id, season, i);
    return `
      <div class="ep-card${hasVideo ? "" : " ep-unavailable"}${isResume ? " ep-resume" : ""}"
           data-video="${escapeHtml(ep.video || "")}"
           data-title="${escapeHtml(safeTitle)}"
           data-season="${escapeHtml(season)}"
           data-ep-idx="${i}"
           data-show-id="${show.id}">
        <div class="ep-num">Ep ${i + 1}${isResume ? ` <span class="ep-resume-badge">Resume</span>` : ""}${pct > 0 && pct < 100 ? ` <span style="color:var(--muted);font-size:0.6rem;margin-left:4px">${pct}%</span>` : ""}</div>
        <div class="ep-title">${escapeHtml(safeTitle)}</div>
        ${ep.duration ? `<div class="ep-meta"><i class="fa-regular fa-clock mr-1 text-xs"></i>${ep.duration}</div>` : ""}
        <i class="fa-solid fa-circle-play ep-play-icon"></i>
      </div>`;
  }).join("");

  episodesList.querySelectorAll(".ep-card:not(.ep-unavailable)").forEach(card => {
    const activate = () => playEpisode(show, card.dataset.season, parseInt(card.dataset.epIdx));
    card.addEventListener("click", activate);
    addKeyboardActivation(card, activate);
  });

  if (lastWatched) {
    requestAnimationFrame(() => {
      const resumeCard = episodesList.querySelector(".ep-resume");
      if (resumeCard) resumeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
}

/* =============================================
   VIDEO PLAYER
   ============================================= */
const videoModal   = $("video-modal");
const videoFrame   = $("video-frame");
const videoClose   = $("video-close");
const plyrWrap     = $("plyr-wrap");
const iframeWrap   = $("iframe-wrap");
const videoTitleEl = $("video-title");

const plyrPlayer = new Plyr("#plyr-player", {
  controls: ["play-large","play","rewind","fast-forward","progress","current-time","duration","mute","volume","fullscreen"],
  invertTime: false,
  tooltips: { controls: true },
});

/* Tracks { show, season, epIdx } for whatever is currently loaded in the
   video modal, so progress-tracking and prev/next navigation don't have
   to depend on the watch-menu's DOM being in a particular state. */
let nowPlaying = null;

plyrPlayer.on("timeupdate", () => {
  try {
    if (!nowPlaying || !plyrPlayer.duration) return;
    const pct = (plyrPlayer.currentTime / plyrPlayer.duration) * 100;
    EpProgress.set(nowPlaying.show.id, nowPlaying.season, nowPlaying.epIdx, pct);
  } catch {}
});

// Autoplay the next episode when a direct-video source finishes.
plyrPlayer.on("ended", () => {
  const target = computeAdjacentEpisode(1);
  if (!target) return;
  const nextEp = target.show.episodes[target.season][target.epIdx];
  showToast(`Up next: ${nextEp.title}`);
  setTimeout(() => playEpisode(target.show, target.season, target.epIdx), 1200);
});

function isDirectVideo(url) {
  if (!url) return false;
  return /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url) || url.includes("archive.org/download");
}

function safeVideoPause() {
  try { if (plyrPlayer?.playing) plyrPlayer.pause(); } catch {}
  videoFrame.src = "";
}

/* Plays a specific episode by reference (show/season/index), handling
   progress tracking, Continue Watching, and the watch-menu highlight —
   this is the single entry point every "play this episode" action goes through. */
function playEpisode(show, season, epIdx) {
  const ep = show?.episodes?.[season]?.[epIdx];
  if (!ep) return;
  if (!ep.video?.trim()) { showToast("Episode link not available yet"); return; }

  currentShow = show;
  Progress.save(show, season, epIdx);
  if (!EpProgress.get(show.id, season, epIdx)) EpProgress.set(show.id, season, epIdx, 5);
  buildContinueWatchingRow();

  if (episodesList) {
    episodesList.querySelectorAll(".ep-card").forEach(c => c.classList.remove("ep-active"));
    const card = [...episodesList.querySelectorAll(".ep-card")]
      .find(c => c.dataset.season === season && parseInt(c.dataset.epIdx) === epIdx);
    if (card) card.classList.add("ep-active");
  }

  openEpisodeVideo(ep.video, `${show.title} — ${ep.title}`, { show, season, epIdx });
}

/* Finds the episode one step before/after nowPlaying (dir = -1 / 1),
   rolling over into the adjacent season when at a season boundary. */
function computeAdjacentEpisode(dir) {
  if (!nowPlaying) return null;
  const { show, season, epIdx } = nowPlaying;
  const seasons = Object.keys(show.episodes || {});
  const curEps  = show.episodes[season] || [];
  const newIdx  = epIdx + dir;
  if (newIdx >= 0 && newIdx < curEps.length) return { show, season, epIdx: newIdx };

  const si = seasons.indexOf(season);
  if (dir === 1 && si > -1 && si < seasons.length - 1) {
    const nextSeason = seasons[si + 1];
    const eps = show.episodes[nextSeason] || [];
    if (eps.length) return { show, season: nextSeason, epIdx: 0 };
  } else if (dir === -1 && si > 0) {
    const prevSeason = seasons[si - 1];
    const eps = show.episodes[prevSeason] || [];
    if (eps.length) return { show, season: prevSeason, epIdx: eps.length - 1 };
  }
  return null;
}

function playAdjacentEpisode(dir) {
  const target = computeAdjacentEpisode(dir);
  if (!target) { showToast(dir === 1 ? "That's the latest episode" : "That's the first episode"); return; }
  playEpisode(target.show, target.season, target.epIdx);
}

function updateVideoNavButtons() {
  const prevBtn = $("video-prev-ep");
  const nextBtn = $("video-next-ep");
  if (!prevBtn || !nextBtn) return;
  prevBtn.classList.toggle("nav-btn-hidden", !nowPlaying);
  nextBtn.classList.toggle("nav-btn-hidden", !nowPlaying);
  if (!nowPlaying) return;
  prevBtn.classList.toggle("nav-btn-disabled", !computeAdjacentEpisode(-1));
  nextBtn.classList.toggle("nav-btn-disabled", !computeAdjacentEpisode(1));
}

function openEpisodeVideo(url, title = "", context = null) {
  if (!url?.trim()) { showToast("Episode link not available yet"); return; }
  nowPlaying = context;
  videoTitleEl.textContent = title;
  if (isDirectVideo(url)) {
    plyrWrap.classList.remove("hidden");
    iframeWrap.classList.add("hidden");
    const type      = url.endsWith(".webm") ? "video/webm" : "video/mp4";
    const isArchive = url.includes("archive.org");
    plyrPlayer.source = {
      type: "video",
      sources: [{ src: url, type }],
      ...(isArchive ? { previewThumbnails: { enabled: false } } : {})
    };
    const videoEl = plyrWrap.querySelector("video");
    if (videoEl) {
      videoEl.preload = "auto";
      if (isArchive) videoEl.setAttribute("data-plyr-config", '{"quality":{"default":"720"}}');
    }
    setTimeout(() => { try { plyrPlayer.play(); } catch {} }, 200);
  } else {
    plyrWrap.classList.add("hidden");
    iframeWrap.classList.remove("hidden");
    videoFrame.src = url + (url.includes("?") ? "&autoplay=1" : "?autoplay=1");
  }
  updateVideoNavButtons();
  videoModal.classList.remove("hidden");
  lockScroll();
}

function closeEpisodeVideo() {
  videoModal.classList.add("hidden");
  safeVideoPause();
  plyrWrap.classList.add("hidden");
  iframeWrap.classList.add("hidden");
  videoTitleEl.textContent = "";
  nowPlaying = null;
  unlockScroll();
}

videoClose.addEventListener("click", closeEpisodeVideo);
videoModal.addEventListener("click", e => { if (e.target === videoModal) closeEpisodeVideo(); });
$("video-prev-ep")?.addEventListener("click", () => playAdjacentEpisode(-1));
$("video-next-ep")?.addEventListener("click", () => playAdjacentEpisode(1));
$("video-lang-btn")?.addEventListener("click", () => showToast("Language & subtitles — coming soon"));

/* =============================================
   SURPRISE ME (random episode)
   ============================================= */
function surpriseMe() {
  if (!SHOWS.length) return showToast("No shows loaded yet");

  const candidates = [];
  for (const show of SHOWS) {
    for (const [season, eps] of Object.entries(show.episodes || {})) {
      eps.forEach((ep, idx) => {
        if (ep.video?.trim()) candidates.push({ show, season, idx, ep });
      });
    }
  }
  if (!candidates.length) return showToast("No episodes available yet");

  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  showToast(`Playing ${pick.show.title} — ${pick.ep.title}`);
  playEpisode(pick.show, pick.season, pick.idx);
}

function setupSurprise() {
  const btn = $("surprise-btn");
  if (btn) btn.addEventListener("click", surpriseMe);
}

/* =============================================
   SEARCH
   ============================================= */
function setupSearch() {
  const wrapper    = $("search-wrapper");
  const toggleBtn  = $("search-toggle");
  const input      = $("search-input");
  const clearBtn   = $("search-clear");
  const resultsBox = $("search-results");
  let searchOpen   = false;

  toggleBtn.addEventListener("click", () => {
    if (!searchOpen) { searchOpen = true; wrapper.classList.add("open"); setTimeout(() => input.focus(), 50); }
    else if (!input.value.trim()) closeSearch();
  });
  clearBtn.addEventListener("click", () => {
    input.value = ""; clearBtn.classList.add("sr-hide"); resultsBox.classList.add("hidden"); input.focus();
  });
  input.addEventListener("input", () => {
    const q = input.value.trim();
    clearBtn.classList.toggle("sr-hide", !q);
    if (q.length > 1) renderSearchResults(q);
    else resultsBox.classList.add("hidden");
  });
  input.addEventListener("keydown", e => { if (e.key === "Escape") closeSearch(); });
  document.addEventListener("click", e => {
    if (!wrapper.contains(e.target) && !resultsBox.contains(e.target)) {
      if (searchOpen && !input.value.trim()) closeSearch();
      else resultsBox.classList.add("hidden");
    }
  });

  function closeSearch() {
    searchOpen = false;
    wrapper.classList.remove("open");
    input.value = "";
    clearBtn.classList.add("sr-hide");
    resultsBox.classList.add("hidden");
  }

  function renderSearchResults(query) {
    const q       = query.toLowerCase().trim();
    const results = [];
    const epNumMatch = q.match(/^(?:ep(?:isode)?\s*)?(\d+)$/);
    const epNum      = epNumMatch ? parseInt(epNumMatch[1]) - 1 : null;
    const SKIP_SEASONS = new Set(["movie","movies","special","specials"]);

    for (const [showIdx, show] of SHOWS.entries()) {
      if (show.title.toLowerCase().includes(q))
        results.push({ type: "show", show, showIdx, label: show.title, sub: show.status || "", poster: show.poster });

      if (!show.episodes) continue;
      for (const [season, eps] of Object.entries(show.episodes)) {
        const seasonPoster = show.seasonPosters?.[season] || show.poster;
        const seasonKey    = season.toLowerCase();

        if (season.toLowerCase().includes(q) && epNum === null)
          results.push({ type: "season", show, showIdx, season, label: season, sub: show.title, poster: seasonPoster });

        if (epNum !== null) {
          if (SKIP_SEASONS.has(seasonKey)) continue;
          const ep = eps[epNum];
          if (ep) results.push({ type: "episode", show, showIdx, season, ep, epIdx: epNum, label: ep.title, sub: `${show.title} · ${season} · Ep ${epNum + 1}`, poster: seasonPoster });
          continue;
        }

        for (const [epIdx, ep] of eps.entries()) {
          if (ep.title?.toLowerCase().includes(q))
            results.push({ type: "episode", show, showIdx, season, ep, epIdx, label: ep.title, sub: `${show.title} · ${season}`, poster: seasonPoster });
        }
      }
    }

    if (!results.length) {
      resultsBox.innerHTML = `<div class="search-no-results"><i class="fa-solid fa-magnifying-glass mb-2 text-gray-600"></i><br>No results for "${escapeHtml(query)}"</div>`;
      resultsBox.classList.remove("hidden");
      return;
    }

    const limited = results.slice(0, 8);
    resultsBox.innerHTML = limited.map((r, i) => `
      <div class="search-result-item" data-result="${i}">
        <img src="${r.poster}" alt="${escapeHtml(r.label)}" loading="lazy" />
        <div class="search-result-info">
          <div class="result-title">${highlightMatch(r.label, q)}</div>
          <div class="result-sub">${escapeHtml(r.sub)}</div>
          ${r.type === "episode" ? `<div class="result-match"><i class="fa-solid fa-play text-xs mr-1"></i>Episode ${r.epIdx + 1}</div>` : ""}
          ${r.type === "season"  ? `<div class="result-match"><i class="fa-solid fa-layer-group text-xs mr-1"></i>${r.show.episodes[r.season]?.length || 0} Episodes</div>` : ""}
        </div>
      </div>`).join("");

    resultsBox.querySelectorAll(".search-result-item").forEach((el, i) => {
      const activate = () => {
        const r = limited[i];
        closeSearch();
        if (r.type === "show") { openModal(r.showIdx); }
        else if (r.type === "season") { openWatchMenu(r.show, r.season); }
        else {
          openWatchMenu(r.show, r.season);
          setTimeout(() => {
            loadEpisodes(r.show, r.season);
            setTimeout(() => {
              const cards = episodesList.querySelectorAll(".ep-card");
              if (cards[r.epIdx]) {
                cards[r.epIdx].scrollIntoView({ behavior: "smooth", block: "nearest" });
                cards[r.epIdx].classList.add("ep-highlight");
                setTimeout(() => cards[r.epIdx].classList.remove("ep-highlight"), 2000);
              }
            }, 120);
          }, 80);
        }
      };
      el.addEventListener("click", activate);
      addKeyboardActivation(el, activate);
    });
    resultsBox.classList.remove("hidden");
  }

  function highlightMatch(text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return escapeHtml(text);
    return `${escapeHtml(text.slice(0, idx))}<mark style="background:rgba(232,66,10,0.32);color:#fff;border-radius:2px;padding:0 2px">${escapeHtml(text.slice(idx, idx + query.length))}</mark>${escapeHtml(text.slice(idx + query.length))}`;
  }
}

/* =============================================
   KEYBOARD ESC
   ============================================= */
function setupKeyboardEsc() {
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!$("video-modal").classList.contains("hidden"))   return closeEpisodeVideo();
      if (!$("trailer-modal").classList.contains("hidden")) return closeTrailer();
      if (!$("watch-modal").classList.contains("hidden"))   return closeWatchMenu();
      if (!$("modal").classList.contains("hidden"))         return closeModal();
      return;
    }
    // "/" jumps to search, unless the user is already typing somewhere
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      $("search-toggle")?.click();
    }
  });
}

/* =============================================
   FOOTER REVEAL
   ============================================= */
function setupFooterReveal() {
  const footer = $("footer");
  if (!footer) return;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      footer.classList.toggle("footer-visible", entry.isIntersecting);
      footer.classList.toggle("footer-hidden",  !entry.isIntersecting);
    }
  }, { threshold: 0.1 });
  observer.observe(footer);
}

/* =============================================
   TOAST
   ============================================= */
function showToast(msg, timeout = 2400) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t.__timer);
  t.__timer = setTimeout(() => t.classList.remove("show"), timeout);
}

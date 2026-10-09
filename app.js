/**
 * National Trust Explorer Application Logic
 */

// LocalStorage Persistence Key
const STORAGE_KEY_ORIGIN = "nt_explorer_origin";

function loadSavedOrigin() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ORIGIN);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name && typeof parsed.lat === "number" && typeof parsed.lon === "number") {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read saved origin from localStorage:", e);
  }
  // Generalized UK default: Central London
  return {
    name: "Central London",
    lat: 51.5074,
    lon: -0.1278
  };
}

// State
let allSites = [];
let filteredSites = [];
let currentOrigin = loadSavedOrigin();
let isMobileMap = false;

// Map objects
let map = null;
let clusterGroup = null;
let originMarker = null;
let rangeCircles = [];
const markerMap = new Map(); // id -> L.marker

// DOM Elements
const searchInput = document.getElementById("search-input");
const clearSearchBtn = document.getElementById("clear-search");
const regionSelect = document.getElementById("region-select");
const categorySelect = document.getElementById("category-select");
const sortSelect = document.getElementById("sort-select");
const distanceSlider = document.getElementById("distance-slider");
const distSliderVal = document.getElementById("dist-slider-val");
const cardsGrid = document.getElementById("cards-grid");
const resultsCountText = document.getElementById("results-count-text");
const resultsSortText = document.getElementById("results-sort-text");
const statTotal = document.getElementById("stat-total-sites");
const statShowing = document.getElementById("stat-showing-sites");
const statUnder30m = document.getElementById("stat-under-30m");
const statUnder1h = document.getElementById("stat-under-1h");
const originDisplay = document.getElementById("origin-name-display");

// Modals
const detailModal = document.getElementById("detail-modal");
const originModal = document.getElementById("origin-modal");

// Category Icons
const CATEGORY_ICONS = {
  "Castle & Fort": "🏰",
  "Historic House & Estate": "🏛️",
  "Gardens & Parkland": "🌸",
  "Coast & Beaches": "🌊",
  "Countryside & Nature Reserve": "🌲",
  "Abbey & Historic Site": "⛪",
  "Mill & Industrial Heritage": "⚙️",
  "Visitor Property & Estate": "🌿"
};

// --- Math & Distance Helpers ---
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Radius of Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateDriveStats(straightMiles) {
  const roadMiles = straightMiles * 1.25;
  let mph = 30.0;
  if (straightMiles >= 100) mph = 58.0;
  else if (straightMiles >= 40) mph = 52.0;
  else if (straightMiles >= 15) mph = 42.0;
  
  const hours = roadMiles / mph;
  const mins = Math.round(hours * 60);
  return {
    roadMiles: Math.round(roadMiles * 10) / 10,
    mins: mins
  };
}

function formatDriveTime(mins) {
  if (mins === null || mins === undefined) return "N/A";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m} mins`;
}

// Recalculate distances for all sites based on current origin
function recomputeDistances() {
  allSites.forEach(s => {
    if (s.latitude && s.longitude) {
      const crow = haversineMiles(currentOrigin.lat, currentOrigin.lon, s.latitude, s.longitude);
      const drive = calculateDriveStats(crow);
      s.crow_miles = Math.round(crow * 10) / 10;
      s.drive_miles = drive.roadMiles;
      s.drive_mins = drive.mins;
      s.directions_url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(currentOrigin.name)}&destination=${s.latitude},${s.longitude}`;
    } else {
      s.crow_miles = null;
      s.drive_miles = null;
      s.drive_mins = null;
      s.directions_url = null;
    }
  });
}

// --- Map Initialization ---
function initMap() {
  map = L.map("map", {
    zoomControl: true,
    minZoom: 5,
    maxZoom: 18
  }).setView([52.4, -1.0], 7);

  // Base tile layers (100% free, no API key, no watermark)
  const osmStandard = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  });

  const esriTopo = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: 'Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ',
    maxZoom: 19
  });

  const esriImagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19
  });

  // Default to OpenStreetMap
  osmStandard.addTo(map);

  // Layer control (allows switching to Satellite or Topo)
  L.control.layers({
    "🗺️ OpenStreetMap": osmStandard,
    "🏔️ Topographic Map": esriTopo,
    "🛰️ Satellite Imagery": esriImagery
  }, null, { position: "topright" }).addTo(map);

  // Marker Cluster Group
  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 15
  });
  map.addLayer(clusterGroup);

  updateOriginOnMap();
}

function updateOriginOnMap() {
  if (originMarker) {
    map.removeLayer(originMarker);
  }
  rangeCircles.forEach(c => map.removeLayer(c));
  rangeCircles = [];

  // Origin Icon
  const originIcon = L.divIcon({
    className: "stevenage-origin-icon",
    html: "📍",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  originMarker = L.marker([currentOrigin.lat, currentOrigin.lon], {
    icon: originIcon,
    zIndexOffset: 1000,
    title: `Origin: ${currentOrigin.name}`
  }).addTo(map);

  originMarker.bindPopup(`
    <div style="padding: 0.5rem; text-align: center;">
      <strong>📍 Departure Origin</strong><br/>
      <span style="color: #007A3B; font-weight: 600;">${currentOrigin.name}</span><br/>
      <small style="color: #64748b;">Distances & drive times calculated from here</small>
      <div style="margin-top: 8px;">
        <button class="origin-btn" onclick="openOriginModal()" style="padding: 0.25rem 0.6rem; cursor: pointer;">Change Location</button>
      </div>
    </div>
  `);

  // Dynamic Range Circle matching user's selected distance filter
  updateDynamicRangeCircle();
}

function updateDynamicRangeCircle() {
  if (!map) return;

  const maxDistance = parseFloat(distanceSlider ? distanceSlider.value : 350);

  // If "All UK" (>= 350 mi), remove range circle
  if (isNaN(maxDistance) || maxDistance >= 350) {
    rangeCircles.forEach(c => map.removeLayer(c));
    rangeCircles = [];
    return;
  }

  const meters = maxDistance * 1609.34;

  if (rangeCircles.length > 0 && rangeCircles[0]) {
    rangeCircles[0].setLatLng([currentOrigin.lat, currentOrigin.lon]);
    rangeCircles[0].setRadius(meters);
  } else {
    rangeCircles.forEach(c => map.removeLayer(c));
    rangeCircles = [];

    const circle = L.circle([currentOrigin.lat, currentOrigin.lon], {
      radius: meters,
      color: "#007A3B",
      weight: 2,
      fillColor: "#007A3B",
      fillOpacity: 0.08,
      interactive: false,
      dashArray: "6, 8"
    }).addTo(map);

    rangeCircles.push(circle);
  }
}

function createCustomPin(cat) {
  const icon = CATEGORY_ICONS[cat] || "🏛️";
  return L.divIcon({
    className: "nt-custom-pin",
    html: `<div style="background: #ffffff; border: 2px solid #007A3B; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${icon}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

function updateMapMarkers() {
  clusterGroup.clearLayers();
  markerMap.clear();

  const bounds = [];

  filteredSites.forEach(s => {
    if (s.latitude && s.longitude) {
      const pin = createCustomPin(s.category);
      const marker = L.marker([s.latitude, s.longitude], {
        icon: pin,
        title: s.name
      });

      const driveStr = s.drive_miles !== null ? `~${s.drive_miles} mi • ${formatDriveTime(s.drive_mins)}` : "-";
      const icon = CATEGORY_ICONS[s.category] || "🏛️";

      const popupHtml = `
        <div class="popup-box">
          <div style="display: flex; gap: 0.3rem; align-items: center;">
            <span>${icon}</span>
            <span class="badge badge-category" style="font-size: 0.7rem;">${s.category}</span>
          </div>
          <div class="popup-title">${s.name}</div>
          <div class="popup-dist">🚗 ${driveStr} from ${currentOrigin.name}</div>
          <div class="popup-desc">${s.region}</div>
          <div class="popup-actions">
            <button class="btn-card btn-primary" onclick="openDetailModal(${s.id || `'${s.slug}'`})">Details</button>
            <a href="${s.directions_url}" target="_blank" rel="noopener noreferrer" class="btn-card btn-outline">Directions</a>
            ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="btn-card btn-secondary">NT Site</a>` : ""}
          </div>
        </div>
      `;
      marker.bindPopup(popupHtml);

      marker.on("click", () => {
        highlightCard(s.id || s.slug);
      });

      clusterGroup.addLayer(marker);
      markerMap.set(s.id || s.slug, marker);
      bounds.push([s.latitude, s.longitude]);
    }
  });

  if (bounds.length > 0 && filteredSites.length < allSites.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }
}

// --- Cards Rendering ---
function renderCards() {
  cardsGrid.innerHTML = "";

  if (filteredSites.length === 0) {
    cardsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>No National Trust places match your criteria</h3>
        <p>Try widening your search radius, selecting all categories, or clearing search text.</p>
        <button class="btn-card btn-primary" style="margin-top: 0.5rem; max-width: 200px;" onclick="resetFilters()">Reset All Filters</button>
      </div>
    `;
    return;
  }

  // Render cards (first 100 for fast DOM rendering, scroll handles rest)
  const displaySites = filteredSites.slice(0, 150);

  const fragment = document.createDocumentFragment();
  displaySites.forEach(s => {
    const card = document.createElement("div");
    card.className = "site-card";
    const cardId = s.id || s.slug;
    card.id = `card-${cardId}`;

    const icon = CATEGORY_ICONS[s.category] || "🏛️";
    const driveStr = s.drive_miles !== null ? `🚗 ~${s.drive_miles} mi • ${formatDriveTime(s.drive_mins)} drive` : "Open space / Local land";
    const idDisplay = s.id ? `NT #${s.id}` : "Website Site";

    card.innerHTML = `
      <div class="card-top">
        <div class="badges-group">
          <span class="badge badge-category">${icon} ${s.category}</span>
          <span class="badge badge-region">${s.region}</span>
          <span class="badge badge-id">${idDisplay}</span>
        </div>
      </div>
      <h3 class="site-name">${s.name}</h3>
      <div class="distance-badge">${driveStr}</div>
      <div class="opening-snippet">🕒 ${s.opening_summary ? s.opening_summary.slice(0, 75) + '...' : 'Open daily'}</div>
      <div class="facilities-preview">
        ${(s.facilities || []).slice(0, 3).map(f => `<span class="facility-chip">${f}</span>`).join('')}
      </div>
      <div class="card-actions">
        <button class="btn-card btn-primary" onclick="event.stopPropagation(); openDetailModal(${s.id || `'${s.slug}'`})">🔍 Details</button>
        ${s.directions_url ? `<a href="${s.directions_url}" target="_blank" rel="noopener noreferrer" class="btn-card btn-outline" onclick="event.stopPropagation();">🧭 Directions</a>` : ""}
        ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="btn-card btn-secondary" onclick="event.stopPropagation();">🔗 Official</a>` : ""}
      </div>
    `;

    card.addEventListener("click", () => {
      onCardClicked(s);
    });

    fragment.appendChild(card);
  });

  cardsGrid.appendChild(fragment);

  // Update Counters
  statShowing.textContent = filteredSites.length;
  resultsCountText.textContent = `Showing ${filteredSites.length} of ${allSites.length} places`;

  // Quick Stats
  const under30 = filteredSites.filter(s => s.drive_mins !== null && s.drive_mins <= 30).length;
  const under60 = filteredSites.filter(s => s.drive_mins !== null && s.drive_mins <= 60).length;
  statUnder30m.textContent = under30;
  statUnder1h.textContent = under60;
}

function onCardClicked(site) {
  highlightCard(site.id || site.slug);
  if (site.latitude && site.longitude && map) {
    // If on mobile and in list view, auto-switch to map view to display this pin
    if (window.innerWidth <= 768 && !isMobileMap) {
      toggleMobileView();
    }
    const marker = markerMap.get(site.id || site.slug);
    if (marker) {
      clusterGroup.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    } else {
      map.setView([site.latitude, site.longitude], 13);
    }
  }
}

function highlightCard(id) {
  document.querySelectorAll(".site-card.highlighted").forEach(c => c.classList.remove("highlighted"));
  const card = document.getElementById(`card-${id}`);
  if (card) {
    card.classList.add("highlighted");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

// --- Filtering & Sorting ---
function applyFilters() {
  const query = searchInput.value.trim().toLowerCase();
  clearSearchBtn.style.display = query ? "block" : "none";

  const selectedRegion = regionSelect.value;
  const selectedCat = categorySelect.value;
  const maxDistance = parseFloat(distanceSlider.value);
  const isAllDist = maxDistance >= 350;

  filteredSites = allSites.filter(s => {
    // Text search
    if (query) {
      const matchName = s.name.toLowerCase().includes(query);
      const matchRegion = s.region.toLowerCase().includes(query);
      const matchCat = s.category.toLowerCase().includes(query);
      const matchSlug = s.slug.toLowerCase().includes(query);
      if (!matchName && !matchRegion && !matchCat && !matchSlug) {
        return false;
      }
    }

    // Region filter
    if (selectedRegion && s.region !== selectedRegion) {
      return false;
    }

    // Category filter
    if (selectedCat && s.category !== selectedCat) {
      return false;
    }

    // Distance filter
    if (!isAllDist) {
      if (s.crow_miles === null || s.crow_miles > maxDistance) {
        return false;
      }
    }

    return true;
  });

  // Sorting
  const sortBy = sortSelect.value;
  if (sortBy === "nearest") {
    filteredSites.sort((a, b) => {
      if (a.drive_miles === null) return 1;
      if (b.drive_miles === null) return -1;
      return a.drive_miles - b.drive_miles;
    });
    resultsSortText.textContent = `Sorted by nearest to ${currentOrigin.name}`;
  } else if (sortBy === "time") {
    filteredSites.sort((a, b) => {
      if (a.drive_mins === null) return 1;
      if (b.drive_mins === null) return -1;
      return a.drive_mins - b.drive_mins;
    });
    resultsSortText.textContent = `Sorted by shortest drive time`;
  } else if (sortBy === "name_asc") {
    filteredSites.sort((a, b) => a.name.localeCompare(b.name));
    resultsSortText.textContent = `Sorted alphabetically (A → Z)`;
  } else if (sortBy === "name_desc") {
    filteredSites.sort((a, b) => b.name.localeCompare(a.name));
    resultsSortText.textContent = `Sorted alphabetically (Z → A)`;
  } else if (sortBy === "region") {
    filteredSites.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
    resultsSortText.textContent = `Sorted by region`;
  }

  renderCards();
  updateMapMarkers();
  updateDynamicRangeCircle();
  updateActiveFiltersBadge();
  syncCategoryChips(selectedCat);

  // Update mobile floating toggle label if map is active
  if (isMobileMap) {
    const label = document.getElementById("mobile-view-label");
    if (label) label.textContent = `View List (${filteredSites.length})`;
  }
}

function resetFilters() {
  searchInput.value = "";
  regionSelect.value = "";
  categorySelect.value = "";
  sortSelect.value = "nearest";
  distanceSlider.value = 350;
  distSliderVal.textContent = "All UK (350+ mi)";
  document.querySelectorAll(".dist-btn").forEach(b => b.classList.remove("active"));
  document.querySelector('.dist-btn[data-dist="all"]').classList.add("active");
  applyFilters();
}

// --- Detail Modal ---
function openDetailModal(idOrSlug) {
  const site = allSites.find(s => s.id === idOrSlug || s.slug === idOrSlug);
  if (!site) return;

  const icon = CATEGORY_ICONS[site.category] || "🏛️";
  document.getElementById("modal-cat").textContent = `${icon} ${site.category}`;
  document.getElementById("modal-region").textContent = site.region;
  document.getElementById("modal-id").textContent = site.id ? `NT #${site.id}` : "Visitor Property";
  document.getElementById("modal-title").textContent = site.name;

  // Drive Hero
  const driveStats = site.drive_miles !== null ? `${site.drive_miles} miles • ~${formatDriveTime(site.drive_mins)}` : "Open access countryside / coastal land";
  document.getElementById("modal-drive-stats").textContent = driveStats;

  const navBtn = document.getElementById("modal-nav-btn");
  if (site.directions_url) {
    navBtn.href = site.directions_url;
    navBtn.style.display = "inline-flex";
  } else {
    navBtn.style.display = "none";
  }

  // Opening text
  document.getElementById("modal-opening-text").textContent = site.opening_summary || "Please check official timetable for seasonal hours.";
  const liveLink = document.getElementById("modal-live-schedule");
  liveLink.href = site.live_schedule_url || site.url || "https://www.nationaltrust.org.uk/visit";

  // Facilities
  const facContainer = document.getElementById("modal-facilities");
  facContainer.innerHTML = (site.facilities || []).map(f => `
    <span class="facility-chip" style="font-size: 0.85rem; padding: 0.25rem 0.6rem;">${f}</span>
  `).join('');

  // Location
  const coords = site.latitude && site.longitude ? `${site.latitude}, ${site.longitude}` : "Coordinates pending";
  document.getElementById("modal-coords").textContent = coords;
  document.getElementById("modal-source").textContent = site.source || "National Trust Official Sitemaps";

  // Official Link
  const offLink = document.getElementById("modal-official-link");
  if (site.url) {
    offLink.href = site.url;
    offLink.style.display = "inline-flex";
  } else {
    offLink.style.display = "none";
  }

  detailModal.classList.add("active");
}

function closeDetailModal() {
  detailModal.classList.remove("active");
}

// --- Origin Modal ---
function openOriginModal() {
  originModal.classList.add("active");
}
window.openOriginModal = openOriginModal;

function closeOriginModal() {
  originModal.classList.remove("active");
}

function updateSortOptionLabels() {
  const opt = document.querySelector('#sort-select option[value="nearest"]');
  if (opt) {
    opt.textContent = `🚗 Nearest to ${currentOrigin.name}`;
  }
}

function setOrigin(name, lat, lon) {
  currentOrigin = { name, lat, lon };
  try {
    localStorage.setItem(STORAGE_KEY_ORIGIN, JSON.stringify(currentOrigin));
  } catch (e) {
    console.warn("Could not save origin to localStorage:", e);
  }
  originDisplay.textContent = name;
  updateSortOptionLabels();
  recomputeDistances();
  if (map) updateOriginOnMap();
  applyFilters();
  closeOriginModal();
}

// Common UK Places Offline Dictionary
const COMMON_UK_PLACES = {
  "london": { name: "Central London", lat: 51.5074, lon: -0.1278 },
  "central london": { name: "Central London", lat: 51.5074, lon: -0.1278 },
  "stevenage": { name: "Stevenage, Herts", lat: 51.9038, lon: -0.1974 },
  "birmingham": { name: "Birmingham", lat: 52.4862, lon: -1.8904 },
  "manchester": { name: "Manchester", lat: 53.4808, lon: -2.2426 },
  "leeds": { name: "Leeds", lat: 53.8008, lon: -1.5491 },
  "bristol": { name: "Bristol", lat: 51.4545, lon: -2.5879 },
  "cambridge": { name: "Cambridge", lat: 52.2053, lon: 0.1218 },
  "oxford": { name: "Oxford", lat: 51.7520, lon: -1.2577 },
  "edinburgh": { name: "Edinburgh", lat: 55.9533, lon: -3.1883 },
  "cardiff": { name: "Cardiff", lat: 51.4816, lon: -3.1791 },
  "glasgow": { name: "Glasgow", lat: 55.8642, lon: -4.2518 },
  "newcastle": { name: "Newcastle", lat: 54.9783, lon: -1.6178 },
  "liverpool": { name: "Liverpool", lat: 53.4084, lon: -2.9916 },
  "sheffield": { name: "Sheffield", lat: 53.3811, lon: -1.4701 },
  "nottingham": { name: "Nottingham", lat: 52.9548, lon: -1.1581 },
  "bath": { name: "Bath", lat: 51.3811, lon: -2.3590 },
  "york": { name: "York", lat: 53.9600, lon: -1.0873 },
  "norwich": { name: "Norwich", lat: 52.6309, lon: 1.2974 },
  "exeter": { name: "Exeter", lat: 50.7184, lon: -3.5339 },
  "plymouth": { name: "Plymouth", lat: 50.3755, lon: -4.1427 },
  "brighton": { name: "Brighton", lat: 50.8225, lon: -0.1372 },
  "southampton": { name: "Southampton", lat: 50.9097, lon: -1.4044 },
  "st albans": { name: "St Albans", lat: 51.7527, lon: -0.3394 },
  "luton": { name: "Luton", lat: 51.8787, lon: -0.4200 },
  "watford": { name: "Watford", lat: 51.6565, lon: -0.3903 },
  "milton keynes": { name: "Milton Keynes", lat: 52.0406, lon: -0.7594 }
};

async function handleCustomOriginSearch() {
  const input = document.getElementById("custom-origin-input");
  const feedback = document.getElementById("origin-search-feedback");
  if (!input || !feedback) return;
  const query = input.value.trim();
  if (!query) {
    feedback.textContent = "Please enter a town, city, or postcode.";
    feedback.className = "search-feedback error";
    return;
  }

  feedback.textContent = `Searching for "${query}"...`;
  feedback.className = "search-feedback loading";

  const key = query.toLowerCase();
  if (COMMON_UK_PLACES[key]) {
    const loc = COMMON_UK_PLACES[key];
    setOrigin(loc.name, loc.lat, loc.lon);
    input.value = "";
    feedback.style.display = "none";
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=gb&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const data = await res.json();
    if (data && data.length > 0) {
      const match = data[0];
      const lat = parseFloat(match.lat);
      const lon = parseFloat(match.lon);
      const displayName = match.display_name.split(",")[0] || query;
      setOrigin(displayName, lat, lon);
      input.value = "";
      feedback.style.display = "none";
    } else {
      feedback.textContent = `Could not find "${query}". Please check spelling or select a city below.`;
      feedback.className = "search-feedback error";
    }
  } catch (err) {
    feedback.textContent = "Search timed out. Please choose a nearby city below.";
    feedback.className = "search-feedback error";
  }
}

// Mobile Floating & Header View Switcher
function toggleMobileView() {
  isMobileMap = !isMobileMap;
  const icon = document.getElementById("mobile-view-icon");
  const label = document.getElementById("mobile-view-label");
  const headerBtn = document.getElementById("mobile-header-view-toggle");

  if (isMobileMap) {
    document.body.classList.add("mobile-map-active");
    if (icon) icon.textContent = "📋";
    if (label) label.textContent = `View List (${filteredSites.length})`;
    if (headerBtn) headerBtn.textContent = "📋 List";
    setTimeout(() => { if (map) map.invalidateSize(); }, 50);
    setTimeout(() => { if (map) map.invalidateSize(); }, 250);
  } else {
    document.body.classList.remove("mobile-map-active");
    if (icon) icon.textContent = "🗺️";
    if (label) label.textContent = "View Map";
    if (headerBtn) headerBtn.textContent = "🗺️ Map";
    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
  }
}

function updateActiveFiltersBadge() {
  const query = searchInput.value.trim();
  const selectedRegion = regionSelect.value;
  const selectedCat = categorySelect.value;
  const maxDistance = parseFloat(distanceSlider.value);
  const sortBy = sortSelect.value;

  let count = 0;
  if (query) count++;
  if (selectedRegion) count++;
  if (selectedCat) count++;
  if (maxDistance < 350) count++;
  if (sortBy !== "nearest") count++;

  const toggleBtn = document.getElementById("toggle-filters-btn");
  const badge = document.getElementById("active-filters-badge");

  if (toggleBtn && badge) {
    if (count > 0) {
      toggleBtn.classList.add("has-active");
      badge.textContent = `(${count})`;
    } else {
      toggleBtn.classList.remove("has-active");
      badge.textContent = "";
    }
  }
}

function syncCategoryChips(cat) {
  const chips = document.querySelectorAll(".cat-chip");
  chips.forEach(chip => {
    if (chip.getAttribute("data-cat") === cat) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  searchInput.addEventListener("input", applyFilters);
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    applyFilters();
  });

  regionSelect.addEventListener("change", applyFilters);
  categorySelect.addEventListener("change", applyFilters);
  sortSelect.addEventListener("change", applyFilters);

  // Category Chips
  document.querySelectorAll(".cat-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".cat-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const cat = chip.getAttribute("data-cat");
      categorySelect.value = cat;
      applyFilters();
    });
  });

  // Mobile Filters Toggle Button
  const toggleFiltersBtn = document.getElementById("toggle-filters-btn");
  if (toggleFiltersBtn) {
    toggleFiltersBtn.addEventListener("click", () => {
      const filters = document.getElementById("collapsible-filters");
      if (filters) filters.classList.toggle("expanded");
    });
  }

  // Mobile Floating View Switcher Button
  const mobileToggle = document.getElementById("mobile-view-toggle");
  if (mobileToggle) {
    mobileToggle.addEventListener("click", toggleMobileView);
  }

  // Mobile Header View Switcher Button
  const mobileHeaderToggle = document.getElementById("mobile-header-view-toggle");
  if (mobileHeaderToggle) {
    mobileHeaderToggle.addEventListener("click", toggleMobileView);
  }

  // Distance Slider
  distanceSlider.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    document.querySelectorAll(".dist-btn").forEach(b => b.classList.remove("active"));
    if (val >= 350) {
      distSliderVal.textContent = "All UK (350+ mi)";
      document.querySelector('.dist-btn[data-dist="all"]').classList.add("active");
    } else {
      distSliderVal.textContent = `Under ${val} mi`;
    }
    updateDynamicRangeCircle();
    applyFilters();
  });

  // Distance Presets
  document.querySelectorAll(".dist-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dist-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const dist = btn.getAttribute("data-dist");
      if (dist === "all") {
        distanceSlider.value = 350;
        distSliderVal.textContent = "All UK (350+ mi)";
      } else {
        distanceSlider.value = dist;
        distSliderVal.textContent = `Under ${dist} mi`;
      }
      updateDynamicRangeCircle();
      applyFilters();
    });
  });

  // View Controls (Split, Cards, Map)
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.getAttribute("data-view");
      const container = document.getElementById("main-container");
      container.className = `app-container ${view}-view`;
      setTimeout(() => {
        if (map) map.invalidateSize();
      }, 200);
    });
  });

  // Modals
  document.getElementById("close-modal").addEventListener("click", closeDetailModal);
  document.getElementById("modal-close-footer-btn").addEventListener("click", closeDetailModal);
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) closeDetailModal();
  });

  document.getElementById("change-origin-btn").addEventListener("click", openOriginModal);
  document.getElementById("close-origin-modal").addEventListener("click", closeOriginModal);
  originModal.addEventListener("click", (e) => {
    if (e.target === originModal) closeOriginModal();
  });

  document.querySelectorAll(".origin-choice-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-name");
      const lat = parseFloat(btn.getAttribute("data-lat"));
      const lon = parseFloat(btn.getAttribute("data-lon"));
      setOrigin(name, lat, lon);
    });
  });

  // Custom Origin Search
  const searchOriginBtn = document.getElementById("search-origin-btn");
  if (searchOriginBtn) {
    searchOriginBtn.addEventListener("click", handleCustomOriginSearch);
  }
  const customOriginInput = document.getElementById("custom-origin-input");
  if (customOriginInput) {
    customOriginInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleCustomOriginSearch();
    });
  }

  // Geolocation
  document.getElementById("geolocate-btn").addEventListener("click", () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setOrigin("My Location", pos.coords.latitude, pos.coords.longitude);
        },
        err => {
          alert("Could not access GPS location. Please check browser permissions.");
        }
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  });

  // Escape key to close modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDetailModal();
      closeOriginModal();
    }
  });

  // Window resize map recalculation
  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });
}

// --- Populate Region Dropdown ---
function populateRegions() {
  const regionCounts = {};
  allSites.forEach(s => {
    regionCounts[s.region] = (regionCounts[s.region] || 0) + 1;
  });

  const sortedRegions = Object.keys(regionCounts).sort();
  sortedRegions.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = `${r} (${regionCounts[r]})`;
    regionSelect.appendChild(opt);
  });
}

// --- App Bootstrap ---
async function initApp() {
  try {
    // 1. Load data
    if (window.NT_SITES_DATA && Array.isArray(window.NT_SITES_DATA)) {
      allSites = window.NT_SITES_DATA;
    } else {
      const resp = await fetch("national_trust_sites.json");
      allSites = await resp.json();
    }

    statTotal.textContent = allSites.length;

    // 2. Compute distances
    originDisplay.textContent = currentOrigin.name;
    updateSortOptionLabels();
    recomputeDistances();

    // 3. Populate region choices
    populateRegions();

    // 4. Init Map
    initMap();

    // 5. Setup Listeners
    setupEventListeners();

    // 6. Initial render
    applyFilters();

    console.log(`National Trust Explorer initialized with ${allSites.length} sites.`);
  } catch (err) {
    console.error("Initialization error:", err);
    cardsGrid.innerHTML = `
      <div class="empty-state">
        <h3>Error loading National Trust dataset</h3>
        <p>${err.message}</p>
      </div>
    `;
  }
}

// Global hook for popup buttons
window.openDetailModal = openDetailModal;

// Run
document.addEventListener("DOMContentLoaded", initApp);

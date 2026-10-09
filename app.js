/**
 * National Trust Explorer Application Logic
 */

// State
let allSites = [];
let filteredSites = [];
let currentOrigin = {
  name: "Stevenage, Herts",
  lat: 51.9038,
  lon: -0.1974
};

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

  // 15, 30, and 60 mile range circles (converted to meters)
  const ranges = [
    { miles: 15, color: "#10b981", opacity: 0.25 },
    { miles: 30, color: "#f59e0b", opacity: 0.18 },
    { miles: 60, color: "#ef4444", opacity: 0.12 }
  ];

  ranges.forEach(r => {
    const meters = r.miles * 1609.34;
    const circle = L.circle([currentOrigin.lat, currentOrigin.lon], {
      radius: meters,
      color: r.color,
      weight: 1.5,
      fillColor: r.color,
      fillOpacity: r.opacity,
      interactive: false,
      dashArray: "4, 6"
    }).addTo(map);
    rangeCircles.push(circle);
  });
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

function setOrigin(name, lat, lon) {
  currentOrigin = { name, lat, lon };
  originDisplay.textContent = name;
  recomputeDistances();
  updateOriginOnMap();
  applyFilters();
  closeOriginModal();
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

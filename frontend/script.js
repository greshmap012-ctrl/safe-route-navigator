
const API_BASE_URL = "https://nee-backend-name.onrender.com";

const $ = id => document.getElementById(id);

const map = L.map("map").setView([16.5062, 80.6480], 13);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

let selectedLocation = null;
let reportMode = false;
let routeLayer = null;
let gpsMarker = null;
let hazardMarkers = [];
let allHazards = [];
let alternativeRouteLayers = [];
let availableRoutes = [];
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

// Check backend connection
async function checkBackend() {
  try {
    const response = await fetch(`${API}/health`);
    if (!response.ok) throw new Error();

    const data = await response.json();
    $("connection").textContent = data.message;
  } catch {
    $("connection").textContent =
      "Backend unavailable. Start node server.js first.";
  }
}


// GPS location
$("gpsBtn").onclick = () => {
  if (!navigator.geolocation) {
    $("status").textContent =
      "GPS is not supported by this browser.";
    return;
  }

  $("status").textContent = "Requesting location permission...";

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      $("start").value = `${lat}, ${lon}`;
      map.setView([lat, lon], 16);

      if (gpsMarker) map.removeLayer(gpsMarker);

      gpsMarker = L.circleMarker([lat, lon], {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: "#1677ff",
        fillOpacity: 1
      }).addTo(map)
        .bindPopup("Your current location")
        .openPopup();

      $("status").textContent =
        "Current location detected. Enter your destination.";
    },
    error => {
      $("status").textContent =
        error.code === 1
          ? "Location permission denied. Allow location access."
          : "Could not get location. Please try again.";
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
};
// Location lookup, including GPS coordinates
async function geocode(place) {
  const coords = place.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
  );

  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);

    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error("Invalid coordinates.");
    }

    return { lat, lon };
  }


  const response = await fetch(
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(place)
  );


  if (!response.ok) throw new Error("Location search failed.");

  const results = await response.json();
  if (!results.length) throw new Error("Location not found.");

  return {
    lat: Number(results[0].lat),
    lon: Number(results[0].lon)
  };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const R = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

function getRouteHazards(routeCoordinates) {
  return allHazards.filter(hazard =>
    routeCoordinates.some(([lon, lat]) =>
      distanceMeters(
        lat,
        lon,
        Number(hazard.latitude),
        Number(hazard.longitude)
      ) <= 250
    )
  );
}

function calculateRouteScores(routes) {
  if (!routes.length) return routes;

  const shortestDistance = Math.min(
    ...routes.map(item => item.route.distance)
  );

  const fastestDuration = Math.min(
    ...routes.map(item => item.route.duration)
  );

  routes.forEach(item => {
    const distancePenalty = shortestDistance > 0
      ? Math.min(
        20,
        ((item.route.distance - shortestDistance) /
          shortestDistance) * 20
      )
      : 0;

    const timePenalty = fastestDuration > 0
      ? Math.min(
        20,
        ((item.route.duration - fastestDuration) /
          fastestDuration) * 20
      )
      : 0;

    const hazardPenalty = item.hazards.length * 15;

    item.score = Math.max(
      0,
      Math.round(
        100 - hazardPenalty -
        distancePenalty - timePenalty
      )
    );
  });

  const bestScore = Math.max(
    ...routes.map(item => item.score)
  );

  routes.forEach(item => {
    item.recommended = item.score === bestScore;
  });

  return routes;
}

// Find route

function selectAlternativeRoute(index) {
  const item = availableRoutes[index];

  if (!item) return;

  // Highlight selected route and dim the others

  // Keep each route's unique colour and line pattern
  const routeStyles = [
    { color: "#168461", dashArray: null },
    { color: "#2878d0", dashArray: "12 8" },
    { color: "#ed8b23", dashArray: "2 9" },
    { color: "#8854c0", dashArray: "16 6 3 6" },
    { color: "#d94f70", dashArray: "5 7" }
  ];

  alternativeRouteLayers.forEach((layer, i) => {
    const style = routeStyles[i % routeStyles.length];

    layer.setStyle({
      color: style.color,
      dashArray: style.dashArray,
      weight: i === index ? 8 : 5,
      opacity: i === index ? 1 : 0.75
    });
  });


  const selectedLayer = alternativeRouteLayers[index];
  selectedLayer.bringToFront();

  routeLayer = selectedLayer;

  map.fitBounds(selectedLayer.getBounds(), {
    padding: [30, 30]
  });

  // Update route information for selected route
  $("distance").textContent =
    (item.route.distance / 1000).toFixed(1) + " km";

  $("duration").textContent =
    Math.round(item.route.duration / 60) + " min";

  $("routeHazards").textContent = item.hazards.length;

  $("safetyScore").textContent =
    item.score + "/100";

  if (item.hazards.length === 0) {
    $("safetyWarning").textContent =
      "No community-reported hazards detected near this route. This does not guarantee safety.";
  } else {
    $("safetyWarning").textContent =
      "Warning: " + item.hazards.length +
      " reported hazard(s) found near this route. Review the map markers before travelling.";
  }

  $("status").textContent =
    "Route " + (index + 1) +
    " selected. This is not a verified safest route.";

  // Highlight selected route card
  document.querySelectorAll(".alternative-route-card")
    .forEach((card, i) => {
      card.style.borderColor =
        i === index ? "#168461" : "#dce9e1";

      card.style.background =
        i === index ? "#f0f8f3" : "#ffffff";
    });
}



function renderAlternativeRoutes(routes) {
  const container = $("alternativeRoutes");
  if (!container) return;

  if (!routes.length) {
    container.innerHTML =
      '<p class="reports-empty">No routes available.</p>';
    return;
  }

  container.innerHTML = routes.map((item, index) => {
    const distance = (item.route.distance / 1000).toFixed(1);
    const duration = Math.round(item.route.duration / 60);

    const recommendationText = item.recommended
      ? "Best match based on distance, time and reported hazards."
      : "Compare this route with the recommended option.";

    return `
            <article class="alternative-route-card ${item.recommended ? "recommended-route" : ""
      }">
                <h3>Route ${index + 1}</h3>

                ${item.recommended
        ? '<span class="recommendation-badge">★ Recommended Route</span>'
        : ""
      }

                <p><strong>Distance:</strong> ${distance} km</p>
                <p><strong>Estimated time:</strong> ${duration} min</p>
                <p><strong>Reported hazards:</strong> ${item.hazards.length}</p>
                <p><strong>Experimental score:</strong> ${item.score}/100</p>

                <p class="recommendation-reason">
                    ${recommendationText}
                </p>

                <button type="button" data-select-route="${index}">
                    ${item.recommended ? "View Recommended Route" : "Choose This Route"}
                </button>
            </article>
        `;
  }).join("");

  container.querySelectorAll("[data-select-route]")
    .forEach(button => {
      button.addEventListener("click", () => {
        selectAlternativeRoute(
          Number(button.dataset.selectRoute)
        );
      });
    });
}



// Find and compare alternative routes
$("routeBtn").onclick = async () => {
  renderAlternativeRoutes(availableRoutes);
  const start = $("start").value.trim();
  const destination = $("destination").value.trim();

  if (!start || !destination) {
    $("status").textContent = "Enter both locations.";
    return;
  }

  $("routeBtn").disabled = true;
  $("status").textContent = "Finding available routes...";

  try {
    const a = await geocode(start);

    await new Promise(resolve => setTimeout(resolve, 1100));

    const b = await geocode(destination);

    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.lon},${a.lat};${b.lon},${b.lat}` +
      `?overview=full&geometries=geojson&alternatives=3`
    );

    if (!response.ok) {
      throw new Error("Routing service unavailable.");
    }

    const data = await response.json();

    if (data.code !== "Ok" || !data.routes.length) {
      throw new Error("No route found.");
    }

    // Remove previously displayed route lines
    alternativeRouteLayers.forEach(layer => {
      map.removeLayer(layer);
    });

    alternativeRouteLayers = [];
    availableRoutes = [];
    routeLayer = null;


    // Prepare routes and count nearby reported hazards
    availableRoutes = data.routes.map(route => {
      const hazards = getRouteHazards(
        route.geometry.coordinates
      );

      return {
        route,
        hazards,
        score: 0,
        recommended: false
      };
    });

    // Rank routes using distance, time, and hazards
    calculateRouteScores(availableRoutes);

    const recommendedIndex = availableRoutes.findIndex(
      item => item.recommended
    );


    // Draw each available route on the map

    // Draw routes with different colours and line styles
    const routeStyles = [
      { color: "#168461", dashArray: null, name: "Recommended" },
      { color: "#2878d0", dashArray: "12 8", name: "Alternative 2" },
      { color: "#ed8b23", dashArray: "2 9", name: "Alternative 3" },
      { color: "#8854c0", dashArray: "16 6 3 6", name: "Alternative 4" },
      { color: "#d94f70", dashArray: "5 7", name: "Alternative 5" }
    ];

    availableRoutes.forEach((item, index) => {
      const style = routeStyles[index % routeStyles.length];

      const layer = L.geoJSON(item.route.geometry, {
        style: {
          color: style.color,
          weight: 6,
          opacity: 0.9,
          dashArray: style.dashArray
        }
      }).addTo(map);

      alternativeRouteLayers.push(layer);
    });

    // Display route comparison cards
    renderAlternativeRoutes(availableRoutes);

    // Select the first route by default
    selectAlternativeRoute(recommendedIndex);
    $("status").textContent =
      availableRoutes.length > 1
        ? availableRoutes.length +
        " routes found. Compare and choose your route."
        : "One route found. No additional alternative was returned.";

  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("routeBtn").disabled = false;
  }
};


// Select a location for a hazard
$("reportBtn").onclick = () => {
  reportMode = true;
  selectedLocation = null;
  $("reportStatus").textContent =
    "Click the map where the hazard is located.";
};

map.on("click", event => {
  if (!reportMode) return;

  selectedLocation = {
    lat: event.latlng.lat,
    lon: event.latlng.lng
  };

  reportMode = false;
  $("reportStatus").textContent =
    `Location selected: ${selectedLocation.lat.toFixed(5)}, ${selectedLocation.lon.toFixed(5)}`;
});

// Submit hazard to backend
$("saveBtn").onclick = async () => {
  if (!selectedLocation) {
    $("reportStatus").textContent =
      "First click Choose Hazard Location, then select a map location.";
    return;
  }

  $("saveBtn").disabled = true;

  try {
    const response = await fetch(`${API}/hazards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: $("hazardType").value,
        description: $("description").value.trim(),
        latitude: selectedLocation.lat,
        longitude: selectedLocation.lon
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Report could not be saved.");
    }

    $("reportStatus").textContent =
      "Hazard report saved to backend successfully!";

    $("description").value = "";
    selectedLocation = null;

    await loadHazards();
  } catch (error) {
    $("reportStatus").textContent = error.message;
  } finally {
    $("saveBtn").disabled = false;
  }
};

// Load reports from backend and display pins
async function loadHazards() {
  try {
    const response = await fetch(`${API}/hazards`);
    if (!response.ok) throw new Error("Could not load reports.");

    const hazards = await response.json();
    allHazards = hazards;

    hazardMarkers.forEach(marker => map.removeLayer(marker));
    hazardMarkers = [];
    $("reports").innerHTML = hazards.length
      ? hazards.map(h => {
        const type = String(h.type || "Other");
        const icons = {
          "Poor lighting": "💡",
          "Waterlogging": "🌊",
          "Accident-prone spot": "🚧",
          "Unsafe area": "⚠️",
          "Other": "📍"
        };

        const icon = icons[type] || "⚠️";
        const isVerified = h.status === "verified";

        const dateText = h.createdAt
          ? new Date(h.createdAt).toLocaleString()
          : "Date unavailable";

        return `
        <article class="report-card">
          <div class="report-card-header">
            <div class="report-icon">${icon}</div>

            <div class="report-title">
              <h3>${escapeHTML(type)}</h3>
              <div class="report-id">Report #${h.id}</div>
            </div>

            <span class="report-status ${isVerified ? "verified" : ""}">
              ${isVerified ? "Verified" : "Unverified"}
            </span>
          </div>

          <p class="report-description">
            ${escapeHTML(h.description || "No additional description provided.")}
          </p>

          <div class="report-details">
            <div class="report-detail">
              <span>📍</span>
              <span>${Number(h.latitude).toFixed(5)},
              ${Number(h.longitude).toFixed(5)}</span>
            </div>

            <div class="report-detail">
              <span>🕒</span>
              <span>${escapeHTML(dateText)}</span>
            </div>
          </div>

          <button class="report-map-btn"
            data-lat="${Number(h.latitude)}"
            data-lon="${Number(h.longitude)}">
            📍 View on Map
          </button>
          <button class="verify-btn" data-id="${h.id}">
  ✓ Verify Report
</button>
        </article>
      `;
      }).join("")
      : '<div class="reports-empty">📋<br><br>No hazard reports yet.<br>Be the first to report a hazard.</div>';



    hazards.forEach(h => {
      const marker = L.marker([h.latitude, h.longitude]).addTo(map);

      marker.bindPopup(
        `<b>${escapeHTML(h.type)}</b><br>` +
        `${escapeHTML(h.description || "No description")}<br>` +
        "<small>Community report — unverified</small>"
      );

      hazardMarkers.push(marker);
    });
  } catch (error) {
    $("reports").textContent =
      "Could not load hazard reports. Check the backend.";
  }
}

$("refreshBtn").onclick = loadHazards;

checkBackend();
loadHazards();
$("reports").addEventListener("click", async event => {
  const button = event.target.closest(".verify-btn");
  if (!button) return;

  button.disabled = true;

  try {
    const response = await fetch(
      `${API}/hazards/${button.dataset.id}/verify`,
      { method: "PATCH" }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Verification failed");
    }

    await loadHazards();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
});


/* ==================================
   DARK MODE TOGGLE
================================== */

const themeToggle = document.getElementById("themeToggle");

function applyTheme(isDark) {
  document.body.classList.toggle("dark-mode", isDark);

  if (themeToggle) {
    themeToggle.textContent = isDark
      ? "☀️ Light Mode"
      : "🌙 Dark Mode";

    themeToggle.setAttribute(
      "aria-pressed",
      String(isDark)
    );
  }
}

// Restore the previously selected theme
let savedDarkMode = false;

try {
  savedDarkMode = localStorage.getItem("saferoute-theme") === "dark";
} catch (error) {
  console.warn("Theme preference could not be loaded.");
}

applyTheme(savedDarkMode);

// Switch themes when the button is clicked
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isDark = !document.body.classList.contains("dark-mode");

    applyTheme(isDark);

    try {
      localStorage.setItem(
        "saferoute-theme",
        isDark ? "dark" : "light"
      );
    } catch (error) {
      console.warn("Theme preference could not be saved.");
    }
  });
}

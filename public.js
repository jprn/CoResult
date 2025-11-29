// public.js – version propre

// Références DOM principales
const resultsContainer = document.getElementById("resultsInner");
const eventInfoContainer = document.getElementById("eventInfo");

// État global
let globalClassResults = [];
let autoScrollSpeedFactor = 1; // 0.5 = lent, 1 = normal, 2 = rapide
let autoScrollDirection = 1; // 1 vers le bas, -1 vers le haut
let balisePaused = false;

// ------------------------
// Initialisation
// ------------------------
(() => {
  const params = new URLSearchParams(window.location.search);
  const fileName = params.get("file");
  if (!fileName) {
    resultsContainer.innerHTML =
      '<div class="no-results">Aucun fichier de course spécifié.</div>';
    return;
  }

  // Charger le fichier XML depuis /Resultats
  fetch(`Resultats/${fileName}`)
    .then((resp) => {
      if (!resp.ok) throw new Error("Impossible de charger le fichier XML");
      return resp.text();
    })
    .then((text) => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "application/xml");
      const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
      if (parseError) throw new Error("Fichier XML invalide");

      renderFromResultList(xmlDoc);
      startAutoScroll();
    })
    .catch((err) => {
      console.error(err);
      resultsContainer.innerHTML =
        '<div class="no-results">Erreur de chargement des résultats.</div>';
    });
})();

// ------------------------
// Rendu principal
// ------------------------
function renderFromResultList(xmlDoc) {
  const eventNode = xmlDoc.getElementsByTagName("Event")[0];
  let eventHtml = "";

  if (eventNode) {
    const eventName =
      textContent(eventNode, "Name") || "Course d’orientation";
    const eventId = textContent(eventNode, "Id") || "";
    const startTime = textContent(eventNode, "StartTime") || "";
    const eventDate = startTime ? startTime.split("T")[0] : "";

    eventHtml += '<div class="event-info">';

    // H1 : date + ID (jour)
    const h1Parts = [];
    if (eventDate) h1Parts.push(eventDate);
    if (eventId) h1Parts.push(eventId);
    const h1Text = h1Parts.length ? h1Parts.join(" · ") : eventName;
    eventHtml += `<h1 class="event-title-main">${escapeHtml(h1Text)}</h1>`;

    // H2 : type de course (Name)
    eventHtml += `<h2 class="event-title-sub">${escapeHtml(
      eventName
    )}</h2>`;

    // H3 dans la pastille : "Résultats officiels"
    eventHtml += '<div class="event-pill event-pill-bottom">';
    eventHtml += '<span class="event-pill-dot"></span>';
    eventHtml +=
      '<h3 class="event-pill-title">Résultats officiels</h3>';
    eventHtml += "</div>";

    // Boutons de contrôle dans le bloc événement
    eventHtml += '<div class="public-controls">';
    eventHtml += '  <div class="public-controls-bottom">';
    eventHtml += '    <div class="scroll-speed-group">';
    eventHtml +=
      '<div class="scroll-indicator" title="Sens de défilement">' +
      '<span class="arrow up">&#9650;</span>' +
      '<span class="arrow down active">&#9660;</span>' +
      '</div>';
    eventHtml +=
      '<button id="scrollPlayBtn" class="btn-splits-all public-btn public-btn-icon" title="Lecture">&#9658;</button>';
    eventHtml +=
      '<button id="scrollStopBtn" class="btn-splits-all public-btn public-btn-icon" title="Stop">&#9724;</button>';
    eventHtml +=
      '<button id="scrollFastBtn" class="btn-splits-all public-btn public-btn-icon" title="Avance rapide">&#9193;</button>';
    eventHtml += '    </div>'; // fin scroll-speed-group
    eventHtml +=
      '<button id="baliseToggleBtn" class="btn-splits-all public-btn balise-btn">Arrêter les balises</button>';
    eventHtml += "  </div>"; // public-controls-bottom
    eventHtml += "</div>"; // public-controls

    eventHtml += "</div>";

    eventInfoContainer.innerHTML = eventHtml;
    eventInfoContainer.style.display = "block";

    // Brancher les handlers sur les boutons
    const playBtn = document.getElementById("scrollPlayBtn");
    const stopBtn = document.getElementById("scrollStopBtn");
    const fastBtn = document.getElementById("scrollFastBtn");
    const baliseToggleBtn = document.getElementById("baliseToggleBtn");

    function updateScrollButtons(mode) {
      if (!playBtn || !stopBtn || !fastBtn) return;
      playBtn.classList.remove("active");
      stopBtn.classList.remove("active");
      fastBtn.classList.remove("active");

      if (mode === "play") {
        autoScrollSpeedFactor = 1;
        playBtn.classList.add("active");
      } else if (mode === "fast") {
        autoScrollSpeedFactor = 3;
        fastBtn.classList.add("active");
      } else if (mode === "stop") {
        autoScrollSpeedFactor = 0;
        stopBtn.classList.add("active");
      }
    }

    if (playBtn && stopBtn && fastBtn) {
      // État initial : lecture normale
      updateScrollButtons("play");

      playBtn.addEventListener("click", () => updateScrollButtons("play"));
      fastBtn.addEventListener("click", () => updateScrollButtons("fast"));
      stopBtn.addEventListener("click", () => updateScrollButtons("stop"));
    }

    if (baliseToggleBtn) {
      baliseToggleBtn.addEventListener("click", onBaliseToggleClick);
    }
  } else {
    eventInfoContainer.style.display = "none";
  }

  // Récupérer les résultats de classe
  const classResults = Array.from(
    xmlDoc.getElementsByTagName("ClassResult")
  );
  globalClassResults = classResults;

  if (!classResults.length) {
    resultsContainer.innerHTML =
      '<div class="no-results">Aucune catégorie trouvée dans ce fichier.</div>';
    return;
  }

  // Construire un tableau unique (type "mur de résultats")
  let html = "";
  const classOptions = [];

  classResults.forEach((classResult, classIndex) => {
    const classNode = classResult.getElementsByTagName("Class")[0];
    const className = classNode
      ? textContent(classNode, "Name")
      : "Catégorie";
    const classId = classNode ? textContent(classNode, "Id") : "";

    const personResults = Array.from(
      classResult.getElementsByTagName("PersonResult")
    );
    if (!personResults.length) return;

    // Stocker l'option de catégorie pour le sélecteur
    classOptions.push({
      index: classIndex,
      label: className,
      meta: classId,
    });

    // Préparer les lignes
    let runners = personResults.map((pr, idx) => {
      const personNode = pr.getElementsByTagName("Person")[0];
      const resultNode = pr.getElementsByTagName("Result")[0];

      const family =
        nestedText(personNode, ["Name", "Family"]) || "";
      const given =
        nestedText(personNode, ["Name", "Given"]) || "";
      const fullName = (given + " " + family).trim() || "(Sans nom)";

      const orgNode = pr.getElementsByTagName("Organisation")[0];
      const club = orgNode
        ? textContent(orgNode, "Name") || ""
        : "";

      const bib = resultNode
        ? textContent(resultNode, "BibNumber") || ""
        : "";
      const start = resultNode
        ? textContent(resultNode, "StartTime") || ""
        : "";
      const status = resultNode
        ? textContent(resultNode, "Status") || ""
        : "";

      // Découpage des temps (legs) pour calculer le temps total
      const splitNodes = resultNode
        ? Array.from(
            resultNode.getElementsByTagName("SplitTime")
          )
        : [];
      let lastTime = 0;
      let timeSeconds = 0;
      splitNodes.forEach((sn) => {
        const t = parseInt(
          textContentNode(sn, "Time") || "0",
          10
        );
        const legSeconds = t > lastTime ? t - lastTime : 0;
        lastTime = t;
        timeSeconds += legSeconds;
      });

      const position = resultNode
        ? textContent(resultNode, "Position") || ""
        : "";

      return {
        fullName,
        club,
        bib,
        start,
        timeSeconds,
        position,
        status,
      };
    });

    if (!runners.length) return;

    // Tri : même logique que côté admin (status + temps)
    runners.sort(compareRunnersSimple);

    // ID unique pour permettre le scroll direct vers une catégorie
    html += `<div class="class-block" id="class-block-${classIndex}">`;
    html += '  <div class="class-title">';
    html += `    <span>${escapeHtml(className)}</span>`;
    html += `    <span class="class-meta">${escapeHtml(
      classId
    )} · ${runners.length} coureur(s)</span>`;
    html += "  </div>";

    html += `
      <table>
        <thead>
          <tr>
            <th class="col-rank">Rg</th>
            <th>Dossard</th>
            <th>Coureur</th>
            <th>Club</th>
            <th>Temps</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
    `;

    let currentRank = 1;
    runners.forEach((r) => {
      const statusOk = r.status === "OK";

      let statusLabel = r.status || "Unknown";
      if (statusLabel === "MisPunch") statusLabel = "PM";
      else if (statusLabel === "Disqualified") statusLabel = "DSQ";
      else if (statusLabel === "DidNotFinish") statusLabel = "DNF";
      else if (statusLabel === "DidNotStart") statusLabel = "DNS";

      const timeDisplay =
        r.timeSeconds > 0 ? formatTime(r.timeSeconds) : "";
      const rankDisplay = statusOk ? String(currentRank++) : "";

      html += `
        <tr>
          <td class="col-rank">${escapeHtml(rankDisplay)}</td>
          <td>${escapeHtml(r.bib)}</td>
          <td>${escapeHtml(r.fullName)}</td>
          <td>${escapeHtml(r.club)}</td>
          <td class="col-time">${escapeHtml(timeDisplay)}</td>
          <td class="col-status">
            <span class="badge">
              <span class="badge-dot" style="background:${
                statusOk ? "#9ff9b5" : "#ffcf7c"
              };"></span>
              <span class="status-${
                statusOk ? "ok" : "notok"
              }">${escapeHtml(statusLabel)}</span>
            </span>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
    html += "</div>";
  });

  if (!html) {
    resultsContainer.innerHTML =
      '<div class="no-results">Aucun coureur à afficher.</div>';
  } else {
    resultsContainer.innerHTML = html;
  }

  // Construire le sélecteur de catégories dans la ligne du bas des contrôles
  const controlsBottom = document.querySelector(".public-controls-bottom");
  const container = document.querySelector(".auto-scroll-container");
  let classSelect = null;

  if (controlsBottom && classOptions.length) {
    const selectorWrapper = document.createElement("div");
    selectorWrapper.className = "class-selector";

    let selectorHtml = "";
    selectorHtml += '<label for="classSelect">Catégorie :</label>';
    selectorHtml += '<select id="classSelect">';
    selectorHtml += '<option value="">Toutes les catégories</option>';
    classOptions.forEach((opt) => {
      const meta = opt.meta ? ` (${escapeHtml(opt.meta)})` : "";
      selectorHtml += `<option value="${opt.index}">${escapeHtml(
        opt.label
      )}${meta}</option>`;
    });
    selectorHtml += "</select>";

    selectorWrapper.innerHTML = selectorHtml;
    controlsBottom.appendChild(selectorWrapper);

    classSelect = selectorWrapper.querySelector("#classSelect");
  }

  // Écouteur sur le sélecteur de catégories pour scroller vers la bonne section
  if (classSelect && container) {
    classSelect.addEventListener("change", (e) => {
      const value = e.target.value;
      if (value === "") {
        // Retour en haut : toutes catégories
        container.scrollTop = 0;
        return;
      }

      const index = parseInt(value, 10);
      if (isNaN(index)) return;

      const block = document.getElementById(`class-block-${index}`);
      if (!block) return;

      const title = block.querySelector(".class-title");
      if (!title) return;

      const maxScroll =
        resultsContainer.scrollHeight - container.clientHeight;
      let target = block.offsetTop;
      if (target > maxScroll) target = maxScroll;
      container.scrollTop = target;

      // Pause du défilement + clignotement du titre pendant 2 secondes
      const previousSpeed = autoScrollSpeedFactor;
      autoScrollSpeedFactor = 0;

      title.classList.add("highlight-category");

      setTimeout(() => {
        title.classList.remove("highlight-category");
        autoScrollSpeedFactor = previousSpeed;
      }, 2000);
    });
  }

  // Gestion des clics sur les flèches de direction
  const scrollIndicator = document.querySelector(".scroll-indicator");
  if (scrollIndicator) {
    const arrowUp = scrollIndicator.querySelector(".arrow.up");
    const arrowDown = scrollIndicator.querySelector(".arrow.down");

    if (arrowUp && arrowDown) {
      arrowUp.addEventListener("click", () => {
        autoScrollDirection = -1;
        arrowUp.classList.add("active");
        arrowDown.classList.remove("active");
      });

      arrowDown.addEventListener("click", () => {
        autoScrollDirection = 1;
        arrowDown.classList.add("active");
        arrowUp.classList.remove("active");
      });
    }
  }

  // Lancer/mettre à jour les balises
  initBalises();
}

// ------------------------
// Tri simple pour la page publique
// ------------------------
function compareRunnersSimple(a, b) {
  const order = {
    OK: 0,
    MisPunch: 1,
    Disqualified: 2,
    DidNotFinish: 3,
    DidNotStart: 4,
  };
  const sa = order[a.status] ?? 99;
  const sb = order[b.status] ?? 99;
  if (sa !== sb) return sa - sb;

  if (a.status === "OK" && b.status === "OK") {
    const ta = a.timeSeconds || Number.POSITIVE_INFINITY;
    const tb = b.timeSeconds || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
  }
  return (a.bib || "").localeCompare(b.bib || "");
}

// ------------------------
// Auto-scroll du tableau
// ------------------------
function startAutoScroll() {
  const container = document.querySelector(".auto-scroll-container");
  const inner = document.getElementById("resultsInner");
  if (!container || !inner) return;

  const step = 1; // pixels
  const interval = 40; // ms

  setInterval(() => {
    const maxScroll = inner.scrollHeight - container.clientHeight;
    if (maxScroll <= 0) return;
    if (autoScrollSpeedFactor === 0) return;

    const direction = autoScrollDirection || 1;
    const delta = step * autoScrollSpeedFactor * direction;
    let current = container.scrollTop + delta;

    // Quand on atteint une extrémité, on repart de l'autre côté
    if (direction > 0 && current >= maxScroll) {
      current = 0;
    } else if (direction < 0 && current <= 0) {
      current = maxScroll;
    }

    container.scrollTop = current;
  }, interval);
}

// ------------------------
// Balisettes animées – feu d’artifice
// ------------------------
function initBalises() {
  const layer = document.getElementById("baliseLayer");
  if (!layer) return;

  layer.innerHTML = "";
  const count = 50;
  for (let i = 0; i < count; i++) {
    const b = document.createElement("div");
    b.className = "balise";
    layer.appendChild(b);
  }

  const balises = Array.from(document.querySelectorAll(".balise"));
  const groupCount = 3;
  const groupSize = Math.ceil(balises.length / groupCount);

  function launchFireworksCycleForGroup(group) {
    if (!group.length || balisePaused) return;

    // Centre aléatoire en haut de l'écran
    const centerX = 30 + Math.random() * 40; // 30–70 vw
    const centerY = 5 + Math.random() * 25; // 5–30 vh

    // Départ en colonne verticale depuis le bas
    const verticalSpacing = 6; // en vh
    group.forEach((b, index) => {
      const yOffset = index * verticalSpacing;
      b.style.transition = "none";
      b.style.transform = `translate(${centerX}vw, ${
        110 + yOffset
      }vh)`;
      // Opacité réduite pour garder l'effet "derrière le tableau"
      b.style.opacity = "0.25";
    });

    // Montée vers le centre
    setTimeout(() => {
      group.forEach((b) => {
        const duration = 2500 + Math.random() * 700;
        b.style.transition = `transform ${duration}ms ease-out`;
        b.style.transform = `translate(${centerX}vw, ${centerY}vh)`;
      });

      // Éclatement autour du centre
      setTimeout(() => {
        group.forEach((b) => {
          const duration = 1800 + Math.random() * 800;
          const angle = Math.random() * Math.PI * 2;
          const radius = 35 + Math.random() * 35; // 35–70 vw
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius;
          b.style.transition =
            "transform " +
            duration +
            "ms ease-out, opacity 1200ms ease-out";
          b.style.transform = `translate(${centerX + dx}vw, ${
            centerY + dy
          }vh)`;
          b.style.opacity = "0";
        });

        // Nouveau cycle pour ce groupe
        setTimeout(() => {
          launchFireworksCycleForGroup(group);
        }, 2600 + Math.random() * 1000);
      }, 2600);
    }, 400 + Math.random() * 600);
  }

  for (let g = 0; g < groupCount; g++) {
    const start = g * groupSize;
    const end = start + groupSize;
    const group = balises.slice(start, end);
    setTimeout(
      () => launchFireworksCycleForGroup(group),
      g * 800
    );
  }
}

// ------------------------
// Contrôles (boutons)
// ------------------------
function onSpeedToggleClick() {
  // Cycle : normale (1) -> rapide (3) -> stop (0) -> normale
  if (autoScrollSpeedFactor === 1) {
    autoScrollSpeedFactor = 3; // plus rapide qu'avant
    this.textContent = "Vitesse défilement : rapide";
  } else if (autoScrollSpeedFactor === 3) {
    autoScrollSpeedFactor = 0; // stop complet
    this.textContent = "Vitesse défilement : stop";
  } else {
    autoScrollSpeedFactor = 1;
    this.textContent = "Vitesse défilement : normale";
  }
}

function onBaliseToggleClick() {
  const layer = document.getElementById("baliseLayer");
  if (!layer) return;

  if (!balisePaused) {
    balisePaused = true;
    layer.innerHTML = "";
    this.textContent = "Relancer les balises";
  } else {
    balisePaused = false;
    layer.innerHTML = "";
    initBalises();
    this.textContent = "Arrêter les balises";
  }
}

// ------------------------
// Helpers
// ------------------------
function textContent(parent, tagName) {
  if (!parent) return "";
  const node = parent.getElementsByTagName(tagName)[0];
  return node && node.textContent ? node.textContent.trim() : "";
}

function textContentNode(node, tagName) {
  if (!node) return "";
  const child = node.getElementsByTagName(tagName)[0];
  return child && child.textContent ? child.textContent.trim() : "";
}

function nestedText(root, path) {
  if (!root) return "";
  let node = root;
  for (const tag of path) {
    node = node.getElementsByTagName(tag)[0];
    if (!node) return "";
  }
  return node.textContent ? node.textContent.trim() : "";
}

function formatTime(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds <= 0) return "";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    return `${minutes}:${pad(seconds)}`;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return str
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

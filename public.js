const resultsContainer = document.getElementById('resultsInner');
const eventInfoContainer = document.getElementById('eventInfo');
const publicHeaderInfo = document.getElementById('publicHeaderInfo');

let globalClassResults = [];

const statusOrder = {
  "OK": 0,
  "MisPunch": 1,
  "Disqualified": 2,
  "DidNotFinish": 3,
  "DidNotStart": 4
};

// Lecture du paramètre ?file=NomDuFichier.xml
(function init() {
  const params = new URLSearchParams(window.location.search);
  const fileName = params.get('file');
  if (!fileName) {
    publicHeaderInfo.textContent = "Aucun fichier de course spécifié.";
    return;
  }

  publicHeaderInfo.textContent = `Course chargée depuis le fichier ${fileName}`;

  // Sur Netlify, éviter les accents dans les chemins -> utiliser 'resultats/'
  fetch(`Resultats/${fileName}`)
    .then(resp => {
      if (!resp.ok) throw new Error('Impossible de charger le fichier XML');
      return resp.text();
    })
    .then(text => {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "application/xml");
      const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
      if (parseError) throw new Error('Fichier XML invalide');

      renderFromResultList(xmlDoc);
      startAutoScroll();
    })
    .catch(err => {
      console.error(err);
      resultsContainer.innerHTML = '<div class="no-results">Erreur de chargement des résultats.</div>';
      publicHeaderInfo.textContent = "Erreur de chargement de la course.";
    });
})();

function renderFromResultList(xmlDoc) {
  const eventNode = xmlDoc.getElementsByTagName("Event")[0];
  let eventHtml = "";
  if (eventNode) {
    const eventName = textContent(eventNode, "Name") || "Course d’orientation";
    const eventId = textContent(eventNode, "Id") || "";
    const startTime = textContent(eventNode, "StartTime") || "";

    eventHtml += '<div class="event-pill">';
    eventHtml += '<span class="event-pill-dot"></span>';
    eventHtml += '<span>Résultats officiels IOF XML</span>';
    eventHtml += '</div>';

    eventHtml += '<div class="event-info">';
    eventHtml += `<p><strong>Événement :</strong> ${escapeHtml(eventName)}</p>`;
    if (eventId) {
      eventHtml += `<p><strong>ID :</strong> ${escapeHtml(eventId)}</p>`;
    }
    if (startTime) {
      eventHtml += `<p><strong>Heure de départ globale :</strong> ${escapeHtml(startTime)}</p>`;
    }
    eventHtml += '</div>';

    eventInfoContainer.innerHTML = eventHtml;
    eventInfoContainer.style.display = 'block';
  } else {
    eventInfoContainer.style.display = 'none';
  }

  const classResults = Array.from(xmlDoc.getElementsByTagName("ClassResult"));
  globalClassResults = classResults;

  if (!classResults.length) {
    resultsContainer.innerHTML = '<div class="no-results">Aucune catégorie trouvée dans ce fichier.</div>';
    return;
  }

  let html = "";

  classResults.forEach(classResult => {
    const classNode = classResult.getElementsByTagName("Class")[0];
    const className = classNode ? textContent(classNode, "Name") : "Catégorie";
    const classId = classNode ? textContent(classNode, "Id") : "";

    const personResults = Array.from(classResult.getElementsByTagName("PersonResult"));

    let allRunners = personResults.map((pr, idx) => {
      const personNode = pr.getElementsByTagName("Person")[0];
      const resultNode = pr.getElementsByTagName("Result")[0];

      const family = nestedText(personNode, ["Name", "Family"]) || "";
      const given = nestedText(personNode, ["Name", "Given"]) || "";
      const fullName = (given + " " + family).trim() || "(Sans nom)";

      const orgNode = pr.getElementsByTagName("Organisation")[0];
      const club = orgNode ? textContent(orgNode, "Name") || "" : "";

      const bib = resultNode ? textContent(resultNode, "BibNumber") || "" : "";
      const startTime = resultNode ? textContent(resultNode, "StartTime") || "" : "";
      const status = resultNode ? textContent(resultNode, "Status") || "" : "";

      const splitNodes = resultNode ? Array.from(resultNode.getElementsByTagName("SplitTime")) : [];
      let legs = [];
      let lastTime = 0;
      splitNodes.forEach((sn, legIndex) => {
        const code = textContentNode(sn, "ControlCode") || "?";
        const t = parseInt(textContentNode(sn, "Time") || "0", 10);
        const legSeconds = t > lastTime ? t - lastTime : 0;
        lastTime = t;
        const splitStatus = textContentNode(sn, "Status") || "";
        const isMissing = splitStatus === "Missing";
        legs.push({ index: legIndex, code, legSeconds, cumulative: t, isMissing });
      });

      let timeSeconds = 0;
      if (legs.length) {
        timeSeconds = legs.reduce((sum, leg) => sum + (leg.legSeconds || 0), 0);
      }

      const position = resultNode ? textContent(resultNode, "Position") || "" : "";

      return {
        pr,
        personNode,
        resultNode,
        fullName,
        club,
        bib,
        startTime,
        timeSeconds,
        position,
        status,
        legs,
        originalIndex: idx,
        overallRank: ""
      };
    });

    if (!allRunners.length) return;

    const bestLegTimes = [];
    allRunners.forEach(r => {
      r.legs.forEach((leg, idx) => {
        if (leg.legSeconds > 0 && (bestLegTimes[idx] === undefined || leg.legSeconds < bestLegTimes[idx])) {
          bestLegTimes[idx] = leg.legSeconds;
        }
      });
    });

    const allSortedForRank = [...allRunners].sort(compareRunners);
    let rankCounterGlobal = 1;
    allSortedForRank.forEach(r => {
      if (r.status === "OK") {
        r.overallRank = rankCounterGlobal++;
      } else {
        r.overallRank = "";
      }
    });

    let runners = allRunners;
    if (!runners.length) return;

    runners.sort(compareRunners);

    html += '<div class="class-block">';
    html += '  <div class="class-title">';
    html += `    <span>${escapeHtml(className)}</span>`;
    html += `    <span class="class-meta">${escapeHtml(classId)} · ${runners.length} coureur(s)</span>`;
    html += '  </div>';

    html += `
      <table>
        <thead>
          <tr>
            <th class="col-rank">Rg</th>
            <th>Dossard</th>
            <th>Coureur</th>
            <th>Club</th>
            <th>Départ</th>
            <th class="col-time">Temps</th>
            <th class="col-status">Statut</th>
          </tr>
        </thead>
        <tbody>
    `;

    runners.forEach(r => {
      const statusOk = r.status === "OK";

      let statusLabel = r.status || "Unknown";
      if (statusLabel === "MisPunch") statusLabel = "PM";
      else if (statusLabel === "Disqualified") statusLabel = "DSQ";
      else if (statusLabel === "DidNotFinish") statusLabel = "DNF";
      else if (statusLabel === "DidNotStart") statusLabel = "DNS";

      const timeDisplay = r.timeSeconds > 0 ? formatTime(r.timeSeconds) : "";
      const rankDisplay = statusOk ? String(r.overallRank) : "";

      html += `
        <tr>
          <td class="col-rank">${escapeHtml(rankDisplay)}</td>
          <td>${escapeHtml(r.bib)}</td>
          <td>
            ${escapeHtml(r.fullName)}
          </td>
          <td>${escapeHtml(r.club)}</td>
          <td class="col-start">${escapeHtml(r.startTime)}</td>
          <td class="col-time">${escapeHtml(timeDisplay)}</td>
          <td class="col-status">
            <span class="badge">
              <span class="badge-dot" style="background:${statusOk ? "#9ff9b5" : "#ffcf7c"};"></span>
              <span class="status-${statusOk ? "ok" : "notok"}">${escapeHtml(statusLabel)}</span>
            </span>
          </td>
        </tr>
      `;

    });

    html += `
        </tbody>
      </table>
    `;
    html += '</div>';
  });

  if (!html) {
    resultsContainer.innerHTML = '<div class="no-results">Aucun coureur à afficher.</div>';
  } else {
    resultsContainer.innerHTML = html;
  }
}

// Tri commun
function compareRunners(a, b) {
  const ra = statusOrder[a.status] ?? 99;
  const rb = statusOrder[b.status] ?? 99;
  if (ra !== rb) return ra - rb;

  if (a.status === "OK" && b.status === "OK") {
    const ta = a.timeSeconds || Number.POSITIVE_INFINITY;
    const tb = b.timeSeconds || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
  }

  return (a.bib || "").localeCompare(b.bib || "");
}

// Helpers
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
  const pad = n => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  } else {
    return `${minutes}:${pad(seconds)}`;
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Auto-scroll du tableau
function startAutoScroll() {
  const container = document.querySelector('.auto-scroll-container');
  const inner = document.getElementById('resultsInner');
  if (!container || !inner) return;

  let direction = 1; // 1 vers le bas, -1 vers le haut
  const step = 0.5; // pixels
  const interval = 80; // ms (plus lent)

  setInterval(() => {
    const maxScroll = inner.scrollHeight - container.clientHeight;
    if (maxScroll <= 0) return;

    let current = container.scrollTop + direction * step;
    if (current >= maxScroll) {
      current = maxScroll;
      direction = -1;
    } else if (current <= 0) {
      current = 0;
      direction = 1;
    }
    container.scrollTop = current;
  }, interval);
}

// Balisettes animées
function initBalises() {
  const layer = document.getElementById('baliseLayer');
  if (!layer) return;

  const count = 10;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'balise';
    layer.appendChild(b);
  }

  const balises = Array.from(document.querySelectorAll('.balise'));

  // Phase 1 : alignées en bas
  function setStartPositions() {
    const spacing = 100 / (balises.length + 1);
    balises.forEach((b, index) => {
      const x = spacing * (index + 1);
      // Position de départ : légèrement sous le bas de l'écran
      b.style.transition = 'none';
      b.style.transform = `translate(${x}vw, 110vh)`;
      b.style.opacity = '1';
    });
  }

  function launchFireworksCycle() {
    setStartPositions();

    // Petite pause avant le décollage
    setTimeout(() => {
      // Phase 2 : montée alignée vers le milieu
      balises.forEach(b => {
        const duration = 2500 + Math.random() * 700; // 2.5-3.2s
        b.style.transition = `transform ${duration}ms ease-out`;
        const current = b.style.transform;
        const xMatch = /translate\(([^v]+)vw,/.exec(current);
        const x = xMatch ? parseFloat(xMatch[1]) : 50;
        b.style.transform = `translate(${x}vw, 55vh)`;
      });

      // Phase 3 : éclatement autour du centre
      setTimeout(() => {
        balises.forEach(b => {
          const duration = 1800 + Math.random() * 800; // 1.8-2.6s
          const angle = Math.random() * Math.PI * 2;
          const radius = 10 + Math.random() * 12; // 10-22vw
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius;
          b.style.transition = `transform ${duration}ms ease-out, opacity 1200ms ease-out`;
          b.style.transform = `translate(${50 + dx}vw, ${50 + dy}vh)`;
          b.style.opacity = '0';
        });

        // Phase 4 : reset et nouveau cycle
        setTimeout(() => {
          launchFireworksCycle();
        }, 2600);
      }, 2600);
    }, 400);
  }

  launchFireworksCycle();
}

// Lancer immédiatement les balises au chargement, indépendamment du XML
initBalises();

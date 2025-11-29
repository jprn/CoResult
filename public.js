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
  fetch(`resultats/${fileName}`)
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
      initBalises();
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

  html += `
    <div class="splits-controls">
      <button id="toggleAllSplits" class="btn-splits-all">Ouvrir tous les splits</button>
    </div>
  `;

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

      const hasLegs = r.legs && r.legs.length > 0;
      const rowId = hasLegs ? "splits-" + Math.random().toString(36).slice(2) : null;

      html += `
        <tr>
          <td class="col-rank">${escapeHtml(rankDisplay)}</td>
          <td>${escapeHtml(r.bib)}</td>
          <td>
            ${escapeHtml(r.fullName)}
            ${hasLegs ? `<div class="splits-toggle" data-target="${rowId}">Voir les splits</div>` : ""}
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

      if (hasLegs) {
        const orderCells = r.legs.map((leg, idx) => `<td>${idx + 1}</td>`).join("");
        const codeCells = r.legs.map(leg => {
          const classes = [];
          if (leg.isMissing) classes.push("split-missing");
          const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
          return `<td${classAttr}>${escapeHtml(leg.code)}</td>`;
        }).join("");

        const timeCells = r.legs.map((leg, idx) => {
          const formatted = formatTime(leg.legSeconds);
          const isBest = bestLegTimes[idx] !== undefined && leg.legSeconds === bestLegTimes[idx];
          const classes = [];
          if (isBest) classes.push("split-best");
          if (leg.isMissing) classes.push("split-missing");
          const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
          return `<td${classAttr}>${escapeHtml(formatted)}</td>`;
        }).join("");

        const cumCells = r.legs.map(leg => {
          const classes = [];
          if (leg.isMissing) classes.push("split-missing");
          const classAttr = classes.length ? ` class="${classes.join(" ")}"` : "";
          return `<td${classAttr}>${escapeHtml(formatTime(leg.cumulative))}</td>`;
        }).join("");

        const splitsTableHtml = `
          <table class="splits-table">
            <tbody>
              <tr>
                <th>Ordre</th>
                ${orderCells}
              </tr>
              <tr>
                <th>Poste</th>
                ${codeCells}
              </tr>
              <tr>
                <th>Temps</th>
                ${timeCells}
              </tr>
              <tr>
                <th>Cumul</th>
                ${cumCells}
              </tr>
            </tbody>
          </table>
        `;

        html += `
          <tr>
            <td colspan="7">
              <div class="splits" id="${rowId}">
                ${splitsTableHtml}
              </div>
            </td>
          </tr>
        `;
      }
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

  // Activation des toggles individuels
  document.querySelectorAll('.splits-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.getAttribute('data-target');
      const box = document.getElementById(targetId);
      if (!box) return;
      const visible = box.style.display === 'block';
      box.style.display = visible ? 'none' : 'block';
      toggle.textContent = visible ? 'Voir les splits' : 'Masquer les splits';
    });
  });

  const toggleAllBtn = document.getElementById('toggleAllSplits');
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allSplits = Array.from(document.querySelectorAll('.splits'));
      if (!allSplits.length) return;
      const anyClosed = allSplits.some(s => s.style.display !== 'block');
      if (anyClosed) {
        allSplits.forEach(s => s.style.display = 'block');
        document.querySelectorAll('.splits-toggle').forEach(t => { t.textContent = 'Masquer les splits'; });
        toggleAllBtn.textContent = 'Fermer tous les splits';
      } else {
        allSplits.forEach(s => s.style.display = 'none');
        document.querySelectorAll('.splits-toggle').forEach(t => { t.textContent = 'Voir les splits'; });
        toggleAllBtn.textContent = 'Ouvrir tous les splits';
      }
    });
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
  const step = 1; // pixels
  const interval = 40; // ms

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

  const count = 8;
  for (let i = 0; i < count; i++) {
    const b = document.createElement('div');
    b.className = 'balise';
    layer.appendChild(b);
  }

  function randomizePosition(el) {
    const x = Math.random() * 100; // vw
    const y = Math.random() * 100; // vh
    const duration = 8 + Math.random() * 6; // 8-14s
    el.style.transition = `transform ${duration}s linear`;
    el.style.transform = `translate(${x}vw, ${y}vh)`;
  }

  const balises = Array.from(document.querySelectorAll('.balise'));
  balises.forEach(b => {
    randomizePosition(b);
    setInterval(() => randomizePosition(b), 10000 + Math.random() * 5000);
  });
}

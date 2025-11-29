const fileInput = document.getElementById('xmlFile');
const resultsContainer = document.getElementById('results');
const eventInfoContainer = document.getElementById('eventInfo');
const errorBox = document.getElementById('error');
const publicLinkBox = document.getElementById('publicLink');
const validateAdminBtn = document.getElementById('validateAdminBtn');
const validateAdminStatus = document.getElementById('validateAdminStatus');
const eventSelect = document.getElementById('eventSelect');
const categorySelect = document.getElementById('categorySelect');
const clubSelect = document.getElementById('clubSelect');

let globalClassResults = [];
let globalEvents = {}; // clé: eventKey (Id ou nom de fichier) -> { xmlDoc, eventId, eventName, fileName }
let globalPublicUrl = '';

const statusOrder = {
  "OK": 0,
  "MisPunch": 1,
  "Disqualified": 2,
  "DidNotFinish": 3,
  "DidNotStart": 4
};

fileInput.addEventListener('change', handleFileSelect);
eventSelect.addEventListener('change', handleEventChange);
categorySelect.addEventListener('change', renderResultsForSelection);
clubSelect.addEventListener('change', renderResultsForSelection);
if (validateAdminBtn) {
  validateAdminBtn.addEventListener('click', onValidateAdminClick);
}

function handleFileSelect(e) {
  errorBox.textContent = '';
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  // Réinitialiser l'état global
  globalEvents = {};
  globalClassResults = [];
  eventSelect.innerHTML = '<option value="">Sélectionnez une course</option>';
  eventSelect.disabled = true;
  categorySelect.disabled = true;
  clubSelect.disabled = true;
  resultsContainer.innerHTML = '<div class="no-results">Aucune course sélectionnée pour le moment.</div>';
  eventInfoContainer.style.display = 'none';

  const parser = new DOMParser();

  const readPromises = files.map(file => {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const text = ev.target.result;
          const xmlDoc = parser.parseFromString(text, "application/xml");

          const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
          if (parseError) {
            console.error("Fichier non valide XML:", file.name);
            return resolve();
          }

          const eventNode = xmlDoc.getElementsByTagName("Event")[0];
          if (!eventNode) {
            console.warn("Aucun Event dans le fichier:", file.name);
            return resolve();
          }

          const eventId = textContent(eventNode, "Id") || "";
          const eventName = textContent(eventNode, "Name") || file.name;
          const key = eventId || file.name;

          globalEvents[key] = {
            xmlDoc,
            eventId,
            eventName,
            fileName: file.name
          };
        } catch (err) {
          console.error("Erreur de lecture du fichier", file.name, err);
        } finally {
          resolve();
        }
      };
      reader.readAsText(file);
    });
  });

  Promise.all(readPromises).then(() => {
    const keys = Object.keys(globalEvents);
    if (!keys.length) {
      errorBox.textContent = "Aucune course valide trouvée dans les fichiers sélectionnés.";
      resultsContainer.innerHTML = '<div class="no-results">Aucune course valide à afficher.</div>';
      return;
    }

    // Remplir le select de courses
    keys.forEach(key => {
      const info = globalEvents[key];
      const labelId = info.eventId || '(sans ID)';
      const labelName = info.eventName || info.fileName;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${labelId} – ${labelName}`;
      eventSelect.appendChild(opt);
    });

    eventSelect.disabled = false;

    // Si une seule course, la sélectionner automatiquement
    if (keys.length === 1) {
      eventSelect.value = keys[0];
      handleEventChange();
    }
  });
}

function handleEventChange() {
  const key = eventSelect.value;
  if (!key || !globalEvents[key]) {
    globalClassResults = [];
    resultsContainer.innerHTML = '<div class="no-results">Aucune course sélectionnée pour le moment.</div>';
    eventInfoContainer.style.display = 'none';
    categorySelect.disabled = true;
    clubSelect.disabled = true;
    if (publicLinkBox) publicLinkBox.textContent = '';
    globalPublicUrl = '';
    if (validateAdminStatus) validateAdminStatus.textContent = '';
    return;
  }

  const info = globalEvents[key];
  const { xmlDoc } = info;

  // Construire le lien public basé sur le nom de fichier
  if (publicLinkBox && info && info.fileName) {
    const fileParam = encodeURIComponent(info.fileName);
    const basePath = window.location.pathname.replace('index.html', '');
    const publicUrl = `${basePath}public.html?file=${fileParam}`;
    globalPublicUrl = publicUrl;
    publicLinkBox.innerHTML = `URL publique : <a href="${publicUrl}" target="_blank">${publicUrl}</a>`;
  }
  renderFromResultList(xmlDoc);
}

function renderFromResultList(xmlDoc) {
  const eventNode = xmlDoc.getElementsByTagName("Event")[0];
  let eventHtml = "";
  if (eventNode) {
    const eventName = textContent(eventNode, "Name") || "Course d’orientation";
    const eventId = textContent(eventNode, "Id") || "";
    const startTime = textContent(eventNode, "StartTime") || "";

    eventHtml += '<div class="event-pill">';
    eventHtml += '<span class="event-pill-dot"></span>';
    eventHtml += '<span>Événement importé depuis ResultList IOF XML</span>';
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
    categorySelect.disabled = true;
    clubSelect.disabled = true;
    return;
  }

  // Remplir sélecteurs catégorie + club
  categorySelect.innerHTML = '<option value="__all__">Toutes les catégories</option>';
  clubSelect.innerHTML = '<option value="__all__">Tous les clubs</option>';
  const seenCategories = new Set();
  const clubsSet = new Set();

  classResults.forEach(classResult => {
    const classNode = classResult.getElementsByTagName("Class")[0];
    const className = classNode ? textContent(classNode, "Name") : "Catégorie";
    const classId = classNode ? textContent(classNode, "Id") : "";
    const key = classId || className;
    const label = classId ? `${className} (${classId})` : className;

    if (!seenCategories.has(key)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      categorySelect.appendChild(opt);
      seenCategories.add(key);
    }

    classResult._ofranceKey = key;

    const personResults = Array.from(classResult.getElementsByTagName("PersonResult"));
    personResults.forEach(pr => {
      const orgNode = pr.getElementsByTagName("Organisation")[0];
      const club = orgNode ? textContent(orgNode, "Name") || "" : "";
      if (club) clubsSet.add(club);
    });
  });

  Array.from(clubsSet).sort((a, b) => a.localeCompare(b)).forEach(clubName => {
    const opt = document.createElement('option');
    opt.value = clubName;
    opt.textContent = clubName;
    clubSelect.appendChild(opt);
  });

  categorySelect.disabled = false;
  clubSelect.disabled = false;

  renderResultsForSelection();
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

function renderResultsForSelection() {
  if (!globalClassResults.length) {
    resultsContainer.innerHTML = '<div class="no-results">Aucune catégorie trouvée dans ce fichier.</div>';
    return;
  }

  const categoryFilter = categorySelect.value || "__all__";
  const clubFilter = clubSelect.value || "__all__";

  let html = "";

  // Bouton global splits
  html += `
    <div class="splits-controls">
      <button id="toggleAllSplits" class="btn-splits-all">Ouvrir tous les splits</button>
    </div>
  `;

  globalClassResults.forEach(classResult => {
    const classNode = classResult.getElementsByTagName("Class")[0];
    const className = classNode ? textContent(classNode, "Name") : "Catégorie";
    const classId = classNode ? textContent(classNode, "Id") : "";
    const key = classResult._ofranceKey || classId || className;

    if (categoryFilter !== "__all__" && key !== categoryFilter) {
      return;
    }

    const personResults = Array.from(classResult.getElementsByTagName("PersonResult"));

    // Construire tous les coureurs de la catégorie
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

      // SplitTime : cumul -> legs + cumul (+ flag Missing si Status=Missing)
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

      // Temps total : somme des temps par poste (legSeconds)
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

    // Meilleurs temps de tronçon pour cette catégorie
    const bestLegTimes = [];
    allRunners.forEach(r => {
      r.legs.forEach((leg, idx) => {
        if (leg.legSeconds > 0 && (bestLegTimes[idx] === undefined || leg.legSeconds < bestLegTimes[idx])) {
          bestLegTimes[idx] = leg.legSeconds;
        }
      });
    });

    // Rang global (tous clubs confondus)
    const allSortedForRank = [...allRunners].sort(compareRunners);
    let rankCounterGlobal = 1;
    allSortedForRank.forEach(r => {
      if (r.status === "OK") {
        r.overallRank = rankCounterGlobal++;
      } else {
        r.overallRank = "";
      }
    });

    // Filtre club
    let runners = allRunners;
    if (clubFilter !== "__all__") {
      runners = allRunners.filter(r => r.club === clubFilter);
    }
    if (!runners.length) return;

    // Tri d’affichage
    runners.sort(compareRunners);

    html += '<div class="class-block">';
    html += '  <div class="class-title">';
    html += `    <span>${escapeHtml(className)}</span>`;
    html += `    <span class="class-meta">${escapeHtml(classId)} · ${runners.length} coureur(s) affiché(s)</span>`;
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

      // Affichage statut
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
    resultsContainer.innerHTML = '<div class="no-results">Aucun coureur à afficher avec ces filtres.</div>';
  } else {
    resultsContainer.innerHTML = html;
  }

  // Activation des toggles individuels
  resultsContainer.querySelectorAll('.splits-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.getAttribute('data-target');
      const box = document.getElementById(targetId);
      if (!box) return;
      const visible = box.style.display === 'block';
      box.style.display = visible ? 'none' : 'block';
      toggle.textContent = visible ? 'Voir les splits' : 'Masquer les splits';
    });
  });

  // Bouton global ouvrir / fermer tous les splits
  const toggleAllBtn = document.getElementById('toggleAllSplits');
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allSplits = Array.from(resultsContainer.querySelectorAll('.splits'));
      if (!allSplits.length) return;

      // Vérifier si au moins un est fermé
      const anyClosed = allSplits.some(s => s.style.display !== 'block');

      if (anyClosed) {
        // Ouvrir tous
        allSplits.forEach(s => s.style.display = 'block');
        resultsContainer.querySelectorAll('.splits-toggle').forEach(t => {
          t.textContent = 'Masquer les splits';
        });
        toggleAllBtn.textContent = 'Fermer tous les splits';
      } else {
        // Fermer tous
        allSplits.forEach(s => s.style.display = 'none');
        resultsContainer.querySelectorAll('.splits-toggle').forEach(t => {
          t.textContent = 'Voir les splits';
        });
        toggleAllBtn.textContent = 'Ouvrir tous les splits';
      }
    });
  }
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

// Validation de la course côté admin (UI uniquement)
function onValidateAdminClick() {
  if (!globalPublicUrl) {
    if (validateAdminStatus) {
      validateAdminStatus.textContent = "Aucune course sélectionnée. Choisissez une course pour générer l’URL publique.";
    }
    return;
  }

  const textToCopy = globalPublicUrl;

  // Utiliser l’API moderne du presse-papiers si disponible
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        if (validateAdminStatus) {
          validateAdminStatus.textContent = "URL publique copiée dans le presse-papiers.";
        }
      })
      .catch(() => {
        if (validateAdminStatus) {
          validateAdminStatus.textContent = `Impossible de copier automatiquement. URL : ${textToCopy}`;
        }
      });
  } else {
    // Fallback pour anciens navigateurs
    const tmp = document.createElement('input');
    tmp.type = 'text';
    tmp.value = textToCopy;
    document.body.appendChild(tmp);
    tmp.select();
    try {
      document.execCommand('copy');
      if (validateAdminStatus) {
        validateAdminStatus.textContent = "URL publique copiée dans le presse-papiers.";
      }
    } catch (e) {
      if (validateAdminStatus) {
        validateAdminStatus.textContent = `Impossible de copier automatiquement. URL : ${textToCopy}`;
      }
    }
    document.body.removeChild(tmp);
  }
}


'use strict';

// QA Bug Tracker V2
// Requires config.js, Firebase compat SDKs and SheetJS.

firebase.initializeApp(APP_CONFIG.firebase);

const auth = firebase.auth();
const fs = firebase.firestore();

const privateDoc = fs.doc('qaTrackerV2/main');
const publicDoc = fs.doc('qaTrackerV2/publicSummary');

let data = { features: [] };
let publicData = { features: [], defectRows: [], updatedAt: null };

let role = 'guest';
let screen = 'landing';
let featureId = null;
let cycleId = null;
let unsub = null;
let unsubPublic = null;

let defectFilter = 'all';
let caseFilter = 'all';
let selected = new Set();
let searchText = '';
let requestedRole = 'admin';
let featureStatusFilter = 'In Progress';

const $ = id => document.getElementById(id);

const safe = value => String(value ?? '').replace(
  /[&<>"']/g,
  char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]
);

const id = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const clone = object => JSON.parse(JSON.stringify(object));

const STATUS = [
  'Not Executed',
  'In Progress',
  'Pass',
  'Fail',
  'Partially Pass',
  'Blocked',
  'Not Applicable'
];

const fields = [
  'testId', 'module', 'scenario', 'steps',
  'expected', 'actual', 'remark', 'defect',
  'blockedReason', 'status'
];

const labels = {
  testId: 'Test Case ID',
  module: 'Module',
  scenario: 'Scenario',
  steps: 'Execution Steps',
  expected: 'Expected Result',
  actual: 'Actual Result',
  remark: 'Remark',
  defect: 'Defect Reference',
  blockedReason: 'Blocked Reason',
  status: 'Status'
};

const hasRole = () => role === 'admin' || role === 'tester';

const getFeature = () =>
  data.features.find(f => f.id === featureId);

const getCycle = () =>
  getFeature()?.cycles.find(c => c.id === cycleId);

const active = feature =>
  feature.cycles.find(c => c.status === 'In Progress');

const latest = feature =>
  active(feature) || feature.cycles.at(-1);

function blankCase(testId = '', module = '', scenario = '') {
  return {
    id: id(),
    testId,
    module,
    scenario,
    steps: '',
    expected: '',
    actual: '',
    remark: '',
    defect: '',
    blockedReason: '',
    status: 'Not Executed',
    origin: 'Baseline'
  };
}

// New cycle: preserve test definition and defect reference.
// Clear execution results, remarks and blocked reason.
function resetCase(testCase) {
  const result = clone(testCase);
  result.status = 'Not Executed';
  result.actual = '';
  result.remark = '';
  result.blockedReason = '';
  return result;
}

function counts(cases = []) {
  const executedStatuses = [
    'Pass', 'Fail', 'Partially Pass',
    'Blocked', 'Not Applicable'
  ];

  return {
    total: cases.length,
    executed: cases.filter(c =>
      executedStatuses.includes(c.status)
    ).length,
    passed: cases.filter(c => c.status === 'Pass').length,
    failed: cases.filter(c => c.status === 'Fail').length,
    blocked: cases.filter(c => c.status === 'Blocked').length,
    pending: cases.filter(c =>
      c.status === 'Not Executed'
    ).length
  };
}

function defectRows(features, onlyCurrent = true) {
  const rows = [];

  for (const feature of features) {
    const cycles = onlyCurrent
      ? [latest(feature)].filter(Boolean)
      : feature.cycles;

    for (const cycle of cycles) {
      for (const tc of cycle.cases) {
        if (!tc.defect?.trim() && tc.status !== 'Blocked') {
          continue;
        }

        const reference = tc.defect || '';

        rows.push({
          feature: feature.name,
          featureId: feature.id,
          cycle: cycle.number,
          testId: tc.testId,
          defect: reference,
          status: tc.status,
          remark: tc.remark || '',
          blockedReason: tc.blockedReason || '',
          blocker: tc.status === 'Blocked',
          url: /^https:\/\//i.test(reference)
            ? reference : ''
        });
      }
    }
  }

  return rows;
}

function uniqueDefects(rows) {
  return new Set(
    rows.filter(r => r.defect.trim())
      .map(r => r.defect.trim().toLowerCase())
  ).size;
}

function publicSummary() {
  const features = data.features.map(feature => {
    const cycle = latest(feature);
    const n = counts(cycle?.cases);
    const rows = defectRows([feature]);

    return {
      id: feature.id,
      name: feature.name,
      type: feature.type,
      cycle: cycle?.number || 0,
      status: cycle?.status || 'Not Started',
      startedAt: cycle?.startedAt || '',
      completedAt: cycle?.completedAt || '',
      ...n,
      defects: uniqueDefects(rows),
      blockedDefects: uniqueDefects(
        rows.filter(r => r.blocker)
      )
    };
  });

  return {
    features,
    defectRows: defectRows(data.features),
    updatedAt: new Date().toISOString()
  };
}

async function save() {
  if (!hasRole()) {
    throw Error('Sign in first');
  }

  await privateDoc.set(data);

  try {
    await publicDoc.set(publicSummary());
  } catch (error) {
    console.error('Dashboard publishing failed', error);
    alert(
      'Data saved, but public dashboard publishing failed: ' +
      error.message
    );
  }
}

function bindPublic() {
  if (unsubPublic) unsubPublic();

  unsubPublic = publicDoc.onSnapshot(
    snapshot => {
      publicData = snapshot.exists
        ? snapshot.data()
        : { features: [], defectRows: [] };

      if (
        ['dashboard', 'defects', 'featureStatus'].includes(screen) &&
        role === 'guest'
      ) {
        render();
      }
    },
    error => console.error('Public dashboard error', error)
  );
}

function bindPrivate() {
  if (unsub) unsub();

  unsub = privateDoc.onSnapshot(
    snapshot => {
      data = snapshot.exists &&
        Array.isArray(snapshot.data()?.features)
        ? snapshot.data()
        : { features: [] };

      if (!snapshot.exists && role === 'admin') {
        save().catch(console.error);
      }

      if (!['login', 'landing'].includes(screen)) {
        render();
      }
    },
    error => alert('Cloud data access failed: ' + error.message)
  );
}

function go(next) {
  screen = next;
  render();
}

function button(text, action, cls = 'secondary') {
  return `<button class="${cls}" onclick="${action}">${safe(text)}</button>`;
}

function shell(body, title = 'QA Bug Tracker V2') {
  return `
    <div class="shell">
      <div class="top">
        <h1>${safe(title)}</h1>
        <div class="actions">
          ${button('Home', "go('landing')")}
          ${button('Dashboard', "go('dashboard')")}
          ${hasRole() ? button('Workspace', "go('features')") : ''}
          ${hasRole() ? button('Sign out', 'logout()') : ''}
        </div>
      </div>
      ${body}
    </div>
  `;
}

function landing() {
  return `
    <div class="landing">
      <h1>QA Bug Tracker</h1>
      <p class="muted" style="text-align:center">
        Choose your workspace
      </p>
      <div class="tiles">
        <button class="tile" onclick="openLogin('admin')">
          <strong>Admin</strong>
          <small>Password protected</small>
        </button>
        <button class="tile" onclick="openLogin('tester')">
          <strong>Tester</strong>
          <small>Password protected</small>
        </button>
        <button class="tile" onclick="go('dashboard')">
          <strong>Dashboard</strong>
          <small>Public read-only summary</small>
        </button>
      </div>
    </div>
  `;
}

function openLogin(nextRole) {
  requestedRole = nextRole;
  go('login');
}

function login() {
  return `
    <div class="panel login">
      <h2>${requestedRole === 'admin' ? 'Admin' : 'Tester'} sign in</h2>
      <p class="muted">
        Enter the password for your provisioned Firebase role account.
      </p>
      <form onsubmit="loginSubmit(event)">
        <input id="password" type="password"
          autocomplete="current-password"
          required placeholder="Password">
        <button class="primary">Sign in</button>
      </form>
      <p id="loginError" class="danger"></p>
    </div>
  `;
}

async function loginSubmit(event) {
  event.preventDefault();

  const email = requestedRole === 'admin'
    ? APP_CONFIG.adminEmail
    : APP_CONFIG.testerEmail;

  try {
    const result = await auth.signInWithEmailAndPassword(
      email, $('password').value
    );

    if (!result.user.emailVerified) {
      throw Error('Verify the Firebase account email first.');
    }

    if (result.user.email?.toLowerCase() !== email.toLowerCase()) {
      throw Error('Incorrect role account.');
    }

    role = requestedRole;
    bindPrivate();
    go('features');
  } catch (error) {
    $('loginError').textContent = error.message;
    await auth.signOut().catch(() => {});
  }
}

async function logout() {
  await auth.signOut();
  role = 'guest';
  data = { features: [] };

  if (unsub) {
    unsub();
    unsub = null;
  }

  go('landing');
}

function dashboard() {
  const features = hasRole()
    ? publicSummary().features
    : (publicData.features || []);

  const notStarted = features.filter(
    f => f.status === 'Not Started'
  ).length;

  const under = features.filter(
    f => f.status === 'In Progress'
  ).length;

  const done = features.filter(
    f => f.status === 'Completed'
  ).length;

  const visibleDefects = hasRole()
    ? defectRows(data.features)
    : (publicData.defectRows || []);

  const total = uniqueDefects(visibleDefects);
  const blocked = uniqueDefects(
    visibleDefects.filter(r => r.blocker)
  );

  return shell(`
    <div class="tiles">
      <button class="tile" onclick="showFeatureStatus('Not Started')">
        <strong>${notStarted}</strong>
        <small>Features Need Testing</small>
      </button>

      <button class="tile" onclick="showFeatureStatus('In Progress')">
        <strong>${under}</strong>
        <small>Features Under Testing</small>
      </button>

      <button class="tile" onclick="showFeatureStatus('Completed')">
        <strong>${done}</strong>
        <small>Completed Features</small>
      </button>

      <div class="tile">
        <button class="link"
          onclick="defectFilter='all';go('defects')">
          <strong>${total}</strong>
          <small>Total Defects</small>
        </button>
        <button class="link"
          onclick="defectFilter='blocker';go('defects')">
          <b>${blocked}</b> Blocked Defects
        </button>
      </div>
    </div>

    <div class="panel">
      <h2>Current Cycle Summary — All Features</h2>
      <div class="tablewrap">
        <table class="data">
          <thead>
            <tr>
              <th>Feature</th><th>Execution Type</th>
              <th>Cycle</th><th>State</th>
              <th>Cases Added/Selected</th><th>Executed</th>
              <th>Passed</th><th>Failed</th>
              <th>Blocked</th><th>Unique Defects</th>
            </tr>
          </thead>
          <tbody>
            ${features.map(f => `
              <tr>
                <td>${safe(f.name)}</td>
                <td>${safe(f.type)}</td>
                <td>${f.cycle || '—'}</td>
                <td>${safe(f.status)}</td>
                <td>${f.total || 0}</td>
                <td>${f.executed || 0}</td>
                <td>${f.passed || 0}</td>
                <td>${f.failed || 0}</td>
                <td>${f.blocked || 0}</td>
                <td>${f.defects || 0}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `, 'Project QA Dashboard');
}

function showFeatureStatus(status) {
  featureStatusFilter = status;
  go('featureStatus');
}

function featureStatus() {
  const features = (
    hasRole()
      ? publicSummary().features
      : publicData.features || []
  ).filter(f => f.status === featureStatusFilter);

  return shell(`
    ${button('Back to Dashboard', "go('dashboard')")}
    <div class="panel">
      <h2>${safe(featureStatusFilter)} Features</h2>
      <div class="tablewrap">
        <table class="data">
          <thead><tr>
            <th>Feature</th><th>Type</th><th>Cycle</th>
            <th>Test Cases</th><th>Executed</th>
            <th>Defects</th><th>Blockers</th>
          </tr></thead>
          <tbody>
            ${features.map(f => `
              <tr>
                <td>${safe(f.name)}</td>
                <td>${safe(f.type)}</td>
                <td>${f.cycle}</td>
                <td>${f.total}</td>
                <td>${f.executed}</td>
                <td>${f.defects}</td>
                <td>${f.blockedDefects}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);
}

function defects() {
  let rows = hasRole()
    ? defectRows(data.features)
    : (publicData.defectRows || []);

  if (defectFilter === 'blocker') {
    rows = rows.filter(r => r.blocker);
  }

  if (searchText) {
    rows = rows.filter(r =>
      Object.values(r).join(' ')
        .toLowerCase()
        .includes(searchText.toLowerCase())
    );
  }

  return shell(`
    <div class="panel">
      <h2>Defects Table — Current Cycles</h2>
      <div class="controls">
        <select onchange="defectFilter=this.value;render()">
          <option value="all" ${defectFilter === 'all' ? 'selected' : ''}>
            All defects
          </option>
          <option value="blocker"
            ${defectFilter === 'blocker' ? 'selected' : ''}>
            Blocked defects
          </option>
        </select>

        <input placeholder="Search defects"
          value="${safe(searchText)}"
          oninput="searchText=this.value;render()">

        ${button('Export defects', 'exportDefects()')}
      </div>

      <div class="tablewrap">
        <table class="data">
          <thead><tr>
            <th>Feature</th><th>Cycle</th><th>Test Case</th>
            <th>Defect Reference</th><th>Status</th>
            <th>Remark</th><th>Blocker</th>
            <th>Blocked Reason</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${safe(r.feature)}</td>
                <td>${r.cycle}</td>
                <td>${safe(r.testId)}</td>
                <td>
                  ${r.url
                    ? `<a href="${safe(r.url)}" target="_blank"
                         rel="noopener noreferrer">${safe(r.defect)}</a>`
                    : safe(r.defect) || '—'}
                </td>
                <td>${safe(r.status)}</td>
                <td>${safe(r.remark)}</td>
                <td>${r.blocker
                  ? '<span class="tag blocked">Blocked Defect</span>'
                  : 'No'}</td>
                <td>${safe(r.blockedReason)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `, 'Total Defects');
}

function features() {
  if (!hasRole()) return landing();

  return shell(`
    <div class="panel">
      <div class="top">
        <h2>Features</h2>
        ${role === 'admin'
          ? button('+ Add Feature', 'addFeature()', 'primary')
          : ''}
      </div>
      <div class="tiles">
        ${data.features.map(f => {
          const c = latest(f);
          return `
            <button class="tile"
              onclick="featureId='${f.id}';cycleId=null;go('feature')">
              <strong>${safe(f.name)}</strong>
              <small>${safe(f.type)} —
                ${c ? 'Cycle ' + c.number + ' — ' + c.status : 'Not Started'}
              </small>
              <small>Baseline: ${f.baseline.length} cases</small>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `, 'Feature Workspace');
}

async function addFeature() {
  if (role !== 'admin') return;

  const name = prompt('Feature name');
  if (!name?.trim()) return;

  const type = prompt(
    'Execution type: Planned or Exploratory',
    'Exploratory'
  );

  if (!['planned', 'exploratory'].includes((type || '').toLowerCase())) {
    return alert('Enter Planned or Exploratory');
  }

  data.features.push({
    id: id(),
    name: name.trim(),
    type: type[0].toUpperCase() + type.slice(1).toLowerCase(),
    baseline: [],
    cycles: []
  });

  await save();
  render();
}

function feature() {
  const f = getFeature();
  if (!f) return go('features');

  const c = latest(f);

  return shell(`
    ${button('Back to Features', "go('features')")}

    <div class="panel">
      <div class="top">
        <h2>${safe(f.name)}
          <span class="tag">${safe(f.type)}</span>
        </h2>
        <div class="actions">
          ${button('Add Baseline Case', 'addBaseline()')}
          ${button('Import Excel', 'chooseImport()')}
          ${button('Export All Cycles', 'exportCycles()')}
          ${role === 'admin'
            ? button('Delete Feature', 'deleteFeature()')
            : ''}
        </div>
      </div>

      <p>Master baseline: <b>${f.baseline.length}</b> cases.</p>

      <div class="controls">
        ${button('Start New Cycle', 'startCycle()', 'primary')}
        ${c ? button('Open Latest Cycle',
          "cycleId=latest(getFeature()).id;go('cycle')") : ''}
      </div>
    </div>

    <div class="panel">
      <h3>Cycle History</h3>
      <div class="tablewrap">
        <table class="data">
          <thead><tr>
            <th>Cycle</th><th>Started</th><th>Completed</th>
            <th>Status</th><th>Selected</th>
            <th>Executed</th><th>Action</th>
          </tr></thead>
          <tbody>
            ${f.cycles.map(c => {
              const n = counts(c.cases);
              return `<tr>
                <td>${c.number}</td>
                <td>${safe(c.startedAt)}</td>
                <td>${safe(c.completedAt || '—')}</td>
                <td>${safe(c.status)}</td>
                <td>${n.total}</td>
                <td>${n.executed}</td>
                <td>${button('View',
                  `cycleId='${c.id}';go('cycle')`)}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>Master Baseline</h3>
      ${baselineTable(f)}
    </div>
  `, 'Feature Summary');
}

function baselineTable(f) {
  return `
    <div class="tablewrap">
      <table class="data">
        <thead><tr>
          <th>Test Case ID</th><th>Module</th>
          <th>Scenario</th><th>Expected</th><th>Origin</th>
        </tr></thead>
        <tbody>
          ${f.baseline.map(t => `<tr>
            <td>${safe(t.testId)}</td>
            <td>${safe(t.module)}</td>
            <td>${safe(t.scenario)}</td>
            <td>${safe(t.expected)}</td>
            <td>${safe(t.origin)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function deleteFeature() {
  if (role !== 'admin') return;

  if (!confirm('Permanently delete this feature and every cycle?')) {
    return;
  }

  data.features = data.features.filter(f => f.id !== featureId);
  await save();
  go('features');
}

async function addBaseline() {
  const f = getFeature();
  if (!f || !hasRole()) return;

  const testId = prompt('Unique Test Case ID');
  if (!testId?.trim()) return;

  if (f.baseline.some(t =>
    t.testId.toLowerCase() === testId.trim().toLowerCase()
  )) {
    return alert('Test Case ID already exists');
  }

  const module = prompt('Module', '') || '';
  const scenario = prompt('Scenario', '') || '';

  f.baseline.push(blankCase(testId.trim(), module, scenario));
  await save();
  render();
}

function startCycle() {
  const f = getFeature();
  if (!f || !hasRole()) return;

  if (active(f)) {
    return alert('Complete the active cycle before starting a new one.');
  }

  if (f.type === 'Planned' && !f.baseline.length) {
    return alert('Planned testing requires baseline test cases.');
  }

  selected = new Set(f.baseline.map(t => t.id));
  go('selection');
}

function selection() {
  const f = getFeature();
  if (!f) return go('features');

  const previous = new Map(
    (f.cycles.at(-1)?.cases || []).map(t => [t.id, t])
  );

  return shell(`
    ${button('Back to Feature', "go('feature')")}

    <div class="panel">
      <h2>Select Test Cases for Cycle ${f.cycles.length + 1}</h2>
      <p class="muted">
        Select all, failed, blocked, or specific test cases.
        New cycles reset execution fields but retain defect references.
      </p>

      <div class="controls">
        ${button('Select All', "selectBy('all')")}
        ${button('Failed', "selectBy('Fail')")}
        ${button('Blocked', "selectBy('Blocked')")}
        ${button('Failed + Blocked', "selectBy('both')")}
        ${button('Clear Selection', "selectBy('none')")}
      </div>

      <div class="tablewrap">
        <table class="data">
          <thead><tr>
            <th>Select</th><th>Test Case ID</th>
            <th>Module</th><th>Scenario</th>
            <th>Previous Status</th>
          </tr></thead>
          <tbody>
            ${f.baseline.map(t => `<tr>
              <td><input type="checkbox"
                ${selected.has(t.id) ? 'checked' : ''}
                onchange="toggleSelection('${t.id}',this.checked)">
              </td>
              <td>${safe(t.testId)}</td>
              <td>${safe(t.module)}</td>
              <td>${safe(t.scenario)}</td>
              <td>${safe(previous.get(t.id)?.status || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="controls">
        ${button('Start Cycle', 'createCycle()', 'primary')}
      </div>
    </div>
  `);
}

function selectBy(which) {
  const f = getFeature();

  const previous = new Map(
    (f.cycles.at(-1)?.cases || []).map(t => [t.id, t])
  );

  selected = new Set(
    f.baseline.filter(t =>
      which === 'all' ||
      (which === 'both' &&
        ['Fail', 'Blocked'].includes(previous.get(t.id)?.status)) ||
      previous.get(t.id)?.status === which
    ).map(t => t.id)
  );

  if (which === 'none') selected.clear();
  render();
}

function toggleSelection(key, checked) {
  if (checked) selected.add(key);
  else selected.delete(key);
}

async function createCycle() {
  const f = getFeature();
  if (!f || !hasRole() || active(f)) return;

  if (f.type === 'Planned' && !selected.size) {
    return alert('Select at least one test case for Planned testing.');
  }

  const number = f.cycles.length + 1;

  const c = {
    id: id(),
    number,
    startedAt: today(),
    completedAt: '',
    completionRemark: '',
    status: 'In Progress',
    cases: f.baseline
      .filter(t => selected.has(t.id))
      .map(resetCase)
  };

  f.cycles.push(c);
  cycleId = c.id;

  await save();
  go('cycle');
}

function cycle() {
  const f = getFeature();
  const c = getCycle();

  if (!f || !c) return go('feature');

  const n = counts(c.cases);
  const editable = c.status === 'In Progress';

  return shell(`
    ${button('Back to Feature', "go('feature')")}

    <div class="panel">
      <div class="top">
        <h2>${safe(f.name)} — Cycle ${c.number}</h2>
        <span class="tag">${safe(c.status)}</span>
      </div>

      <div class="summary">
        <span>Started: ${safe(c.startedAt)}</span>
        <span>Added/Selected: ${n.total}</span>
        <span>Executed: ${n.executed}</span>
        <span>Passed: ${n.passed}</span>
        <span>Failed: ${n.failed}</span>
        <span>Blocked: ${n.blocked}</span>
      </div>

      <div class="controls">
        ${editable
          ? button('+ New Test Case', 'addCycleCase()', 'primary')
          : ''}
        ${editable ? button('Import Excel', 'chooseImport()') : ''}
        ${editable
          ? button('Complete Cycle', 'completeCycle()', 'primary')
          : ''}
        ${button('Export All Cycles', 'exportCycles()')}
      </div>

      ${!editable ? `
        <p>Completed: ${safe(c.completedAt)}</p>
        <p>Remark: ${safe(c.completionRemark)}</p>
      ` : ''}
    </div>

    <div class="panel">
      <h3>Test Cases</h3>
      <p class="muted">
        Changes save when a field loses focus.
      </p>
      <div class="tablewrap">
        <table class="data">
          <thead><tr>
            ${fields.map(k => `<th>${labels[k]}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${c.cases.map(t => `<tr>
              ${fields.map(k =>
                `<td>${cell(t, k, editable)}</td>`
              ).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `, 'Test Cycle Execution');
}

function cell(t, key, editable) {
  const value = t[key] || '';

  if (!editable) {
    if (key === 'defect' && /^https:\/\//i.test(value)) {
      return `<a href="${safe(value)}" target="_blank"
        rel="noopener noreferrer">${safe(value)}</a>`;
    }
    return safe(value);
  }

  if (key === 'status') {
    return `<select onchange="editCase('${t.id}','status',this.value,this)">
      ${STATUS.map(s => `<option value="${safe(s)}"
        ${s === value ? 'selected' : ''}>${safe(s)}</option>`
      ).join('')}
    </select>`;
  }

  if (key === 'testId') return safe(value);

  if ([
    'scenario', 'steps', 'expected', 'actual',
    'remark', 'blockedReason'
  ].includes(key)) {
    return `<textarea onblur="editCase('${t.id}','${key}',this.value,this)"
      >${safe(value)}</textarea>`;
  }

  return `<input value="${safe(value)}"
    onblur="editCase('${t.id}','${key}',this.value,this)">`;
}

async function editCase(tcId, key, value, element) {
  const f = getFeature();
  const c = getCycle();
  const t = c?.cases.find(x => x.id === tcId);

  if (!t || c.status !== 'In Progress') return;

  if (
    key === 'status' &&
    value === 'Blocked' &&
    !t.blockedReason.trim()
  ) {
    alert('Enter a Blocked Reason before selecting Blocked.');
    element.value = t.status;
    return;
  }

  t[key] = value;

  if (key === 'status' && value !== 'Blocked') {
    t.blockedReason = '';
  }

  if (['module', 'scenario', 'steps', 'expected', 'defect'].includes(key)) {
    const base = f.baseline.find(x => x.id === tcId);
    if (base) base[key] = value;
  }

  try {
    await save();
  } catch (error) {
    alert('Save failed: ' + error.message);
  }

  if (key === 'status') render();
}

async function addCycleCase() {
  const f = getFeature();
  const c = getCycle();

  if (c?.status !== 'In Progress') return;

  const testId = prompt('Unique Test Case ID');
  if (!testId?.trim()) return;

  if (f.baseline.some(t =>
    t.testId.toLowerCase() === testId.trim().toLowerCase()
  )) {
    return alert('Test Case ID already exists in baseline.');
  }

  const module = prompt('Module', '') || '';
  const scenario = prompt('Scenario', '') || '';

  const t = blankCase(testId.trim(), module, scenario);
  t.origin = `Added in Test Cycle ${c.number}`;

  f.baseline.push(clone(t));
  c.cases.push(t);

  await save();
  render();
}

async function completeCycle() {
  const c = getCycle();
  if (!c || c.status !== 'In Progress') return;

  const n = counts(c.cases);

  const remark = prompt(
    `Complete Cycle ${c.number}?\n` +
    `${n.pending} Not Executed and ${n.blocked} Blocked remain.\n` +
    'Enter completion remark (required):'
  );

  if (!remark?.trim()) return;

  if (!confirm('Confirm completion? This cycle becomes read-only.')) {
    return;
  }

  c.status = 'Completed';
  c.completedAt = today();
  c.completionRemark = remark.trim();

  await save();
  render();
}

// ---------------- Excel Import ----------------

function chooseImport() {
  if (!hasRole()) return;

  const f = getFeature();
  if (!f) return alert('Open a feature first.');

  $('uploadInput').click();
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const headerAliases = {
  testId: ['testcaseid', 'testid', 'testcase', 'srno', 'serialno'],
  module: ['module', 'feature'],
  scenario: ['scenario', 'testscenario', 'description'],
  steps: ['executionstep', 'executionsteps', 'steps', 'procedure'],
  expected: ['expectedresult', 'expectedbehavior', 'expected'],
  actual: ['actualresult', 'actualbehavior', 'actual'],
  remark: ['remark', 'comment', 'comments'],
  defect: ['defect', 'defectreference', 'defectnumber',
    'bugid', 'defectlink'],
  blockedReason: ['blockedreason', 'blockerreason'],
  status: ['status', 'teststatus']
};

function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);

    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: 'array' });
        const entries = [];

        for (const name of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(
            workbook.Sheets[name],
            { defval: '', raw: false }
          );

          if (!rows.length) continue;

          const headers = Object.keys(rows[0]);
          const map = {};

          for (const key of fields) {
            const matches = headers.filter(h =>
              headerAliases[key].includes(normalize(h))
            );

            if (matches.length > 1) {
              throw Error('Ambiguous columns for ' + labels[key]);
            }

            if (matches.length) map[key] = matches[0];
          }

          if (!map.testId) {
            throw Error(`Sheet ${name} needs a Test Case ID column.`);
          }

          if (!map.scenario) {
            throw Error(`Sheet ${name} needs a Scenario column.`);
          }

          for (const row of rows) {
            if (!String(row[map.testId] || '').trim()) continue;

            const entry = {};

            for (const key of fields) {
              entry[key] = map[key]
                ? String(row[map[key]] ?? '').trim()
                : '';
            }

            entries.push(entry);
          }
        }

        resolve(entries);
      } catch (error) {
        reject(error);
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

async function importExcel(event) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) return;

  const f = getFeature();
  if (!f || !hasRole()) return;

  const c = getCycle();

  if (c && c.status === 'Completed' && screen === 'cycle') {
    return alert('Cannot import into a completed cycle.');
  }

  try {
    const entries = await parseExcel(file);
    const unique = new Map();

    for (const row of entries) {
      const key = row.testId.toLowerCase();

      if (unique.has(key)) {
        throw Error('Duplicate Test Case ID: ' + row.testId);
      }

      unique.set(key, row);
    }

    const existing = new Map(
      f.baseline.map(t => [t.testId.toLowerCase(), t])
    );

    const adds = [...unique.values()].filter(
      t => !existing.has(t.testId.toLowerCase())
    ).length;

    const updates = unique.size - adds;

    if (!confirm(
      `Import ${unique.size} cases?\n` +
      `${adds} new, ${updates} existing.\n` +
      'Existing execution results will be preserved.'
    )) return;

    for (const row of unique.values()) {
      let t = existing.get(row.testId.toLowerCase());

      if (!t) {
        t = blankCase(row.testId, row.module, row.scenario);
        t.origin = c
          ? `Added in Test Cycle ${c.number}`
          : 'Imported to Baseline';

        f.baseline.push(t);
        existing.set(row.testId.toLowerCase(), t);
      }

      for (const key of [
        'module', 'scenario', 'steps', 'expected', 'defect'
      ]) {
        if (row[key]) t[key] = row[key];
      }

      if (c && c.status === 'In Progress') {
        let current = c.cases.find(x => x.id === t.id);

        if (!current) {
          current = resetCase(t);
          c.cases.push(current);
        }

        for (const key of [
          'module', 'scenario', 'steps', 'expected', 'defect'
        ]) {
          if (row[key]) current[key] = row[key];
        }
      }
    }

    await save();

    alert(
      `Imported: ${adds} new, ${updates} matched.\n` +
      'No duplicate Test Case IDs created.'
    );

    render();
  } catch (error) {
    alert('Import rejected: ' + error.message);
  }
}

// ---------------- Excel Export ----------------

function exportCycles() {
  const f = getFeature();
  if (!f) return;

  const workbook = XLSX.utils.book_new();

  const summary = f.cycles.map(c => ({
    Feature: f.name,
    Type: f.type,
    Cycle: c.number,
    Started: c.startedAt,
    Completed: c.completedAt,
    Status: c.status,
    Remark: c.completionRemark,
    ...counts(c.cases)
  }));

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      summary.length
        ? summary
        : [{ Feature: f.name, Note: 'No cycles yet' }]
    ),
    'Summary'
  );

  for (const c of f.cycles) {
    const rows = c.cases.map(t =>
      Object.fromEntries(
        [...fields, 'origin'].map(key => [
          labels[key] || 'Origin',
          t[key] || ''
        ])
      )
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        rows.length ? rows : [{ Note: 'No test cases' }]
      ),
      `Cycle ${c.number}`.slice(0, 31)
    );
  }

  XLSX.writeFile(
    workbook,
    `${f.name.replace(/[^a-z0-9_-]/gi, '_')}_All_Cycles.xlsx`
  );
}

function exportDefects() {
  const source = hasRole()
    ? defectRows(data.features)
    : (publicData.defectRows || []);

  const rows = source
    .filter(r => defectFilter !== 'blocker' || r.blocker)
    .map(r => ({
      Feature: r.feature,
      Cycle: r.cycle,
      'Test Case': r.testId,
      'Defect Reference': r.defect,
      Status: r.status,
      Remark: r.remark,
      Blocker: r.blocker ? 'Yes' : 'No',
      'Blocked Reason': r.blockedReason
    }));

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ Note: 'No defects' }]
    ),
    'Defects'
  );

  XLSX.writeFile(workbook, 'QA_Current_Cycle_Defects.xlsx');
}

// ---------------- Application Initialization ----------------

function render() {
  const root = $('app');
  if (!root) return;

  const views = {
    landing,
    login,
    dashboard,
    features,
    feature,
    selection,
    cycle,
    defects,
    featureStatus
  };

  root.innerHTML = (views[screen] || landing)() + `
    <input id="uploadInput" type="file"
      accept=".xlsx,.xls,.csv"
      hidden onchange="importExcel(event)">
  `;
}

auth.onAuthStateChanged(user => {
  const admin = user?.email?.toLowerCase() ===
    APP_CONFIG.adminEmail.toLowerCase();

  const tester = user?.email?.toLowerCase() ===
    APP_CONFIG.testerEmail.toLowerCase();

  role = user?.emailVerified
    ? (admin ? 'admin' : tester ? 'tester' : 'guest')
    : 'guest';

  if (hasRole()) {
    bindPrivate();
  } else if (unsub) {
    unsub();
    unsub = null;
    data = { features: [] };
  }

  render();
});

bindPublic();
render();

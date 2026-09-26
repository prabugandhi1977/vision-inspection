const els = {
  total: document.querySelector('#totalCount'),
  passRate: document.querySelector('#passRate'),
  fail: document.querySelector('#failCount'),
  cycle: document.querySelector('#cycleTime'),
  partId: document.querySelector('#partId'),
  elapsed: document.querySelector('#elapsedTime'),
  table: document.querySelector('#recentTable'),
  runControl: document.querySelector('#runControl'),
  simulate: document.querySelector('#simulateButton'),
  toast: document.querySelector('#toast'),
};

let state = { running: true, total: 12450, fails: 240, part: 1248 };

const showToast = (message, type = '') => {
  els.toast.textContent = message;
  els.toast.className = `toast show ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.className = 'toast'; }, 2600);
};

const clock = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const padPart = (number) => `A${String(number).padStart(6, '0')}`;

function refreshMetrics(cycle) {
  const pass = state.total - state.fails;
  const rate = ((pass / state.total) * 100).toFixed(2);
  els.total.textContent = state.total.toLocaleString('en-US');
  els.fail.textContent = state.fails.toLocaleString('en-US');
  els.passRate.innerHTML = `${rate}<sup>%</sup>`;
  els.cycle.innerHTML = `${cycle.toFixed(2)}<sup>s</sup>`;
}

function addPart() {
  if (!state.running) { showToast('Line is paused. Resume production to simulate a part.', 'error'); return; }
  const isPass = Math.random() > 0.16;
  const cycle = 1.25 + Math.random() * .25;
  const id = padPart(++state.part);
  state.total += 1;
  if (!isPass) state.fails += 1;
  els.partId.textContent = id;
  els.elapsed.textContent = `${cycle.toFixed(2)} sec`;
  refreshMetrics(cycle);
  const resultClass = isPass ? 'pass-chip' : 'fail-chip';
  const result = isPass ? 'PASS' : 'FAIL';
  const row = document.createElement('tr');
  row.innerHTML = `<td>${clock()}</td><td><strong>${id}</strong></td><td><span class="result-chip ${resultClass}">● ${result}</span></td><td>v1.2</td><td>${cycle.toFixed(2)}s</td><td><button aria-label="View part ${id}">›</button></td>`;
  els.table.prepend(row);
  if (els.table.children.length > 4) els.table.lastElementChild.remove();
  showToast(`${id}: ${result} · inspection recorded`, isPass ? '' : 'error');
}

els.runControl.addEventListener('click', () => {
  state.running = !state.running;
  els.runControl.innerHTML = state.running ? '<span>Ⅱ</span> Pause line' : '<span>▶</span> Resume line';
  const status = document.querySelector('.running-status strong');
  const dot = document.querySelector('.pulse');
  status.textContent = state.running ? 'RUNNING' : 'PAUSED';
  status.style.color = state.running ? '' : '#d37a42';
  dot.style.background = state.running ? '' : '#e79c57';
  dot.style.boxShadow = state.running ? '' : '0 0 0 5px #fff0de';
  showToast(state.running ? 'Production line resumed safely.' : 'Production line paused. PLC notified.');
});

els.simulate.addEventListener('click', addPart);

document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelector('.nav-item.active').classList.remove('active');
    item.classList.add('active');
    if (item.getAttribute('href') === '#dashboard') window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.querySelector(item.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelector('#detailsButton').addEventListener('click', () => showToast('Inspection A001247: all enabled steps passed.'));
document.querySelector('#allResults').addEventListener('click', () => showToast('Traceability archive is ready for filtered review.'));
document.querySelector('#periodButton').addEventListener('click', () => showToast('Showing defect distribution for Shift 1.'));
document.querySelector('#notifications').addEventListener('click', () => showToast('2 notifications: retention review and scheduled calibration.'));
document.querySelector('#helpButton').addEventListener('click', () => showToast('Operator help: acknowledge alarms or contact your line lead.'));
document.querySelector('#profileButton').addEventListener('click', () => showToast('Signed in as Sakthi M. · Production operator.'));



function encodeURL(url) {
  const b64 = btoa(unescape(encodeURIComponent(url)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const prefix = shortHash(url);

  return prefix + '-' + b64;
}

function decodeCode(code) {
  const sep = code.indexOf('-');
  if (sep === -1) return null;

  const b64part = code.slice(sep + 1);

  let b64 = b64part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';

  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return null;
  }
}

function shortHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const raw = Math.abs(h).toString(36).toUpperCase();
  return (raw + 'AAAAAA').slice(0, 6);
}

const STORAGE_KEY = 'smartbrowser_codes';

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistory(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

let lastGeneratedCode = '';

function generateCode() {
  const input = document.getElementById('linkInput');
  const errorText = document.getElementById('errorText');
  const url = input.value.trim();

  if (!url) {
    errorText.textContent = 'Please enter a test link.';
    input.focus();
    return;
  }

  try {
    const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!parsed.hostname.includes('.')) throw new Error();
  } catch {
    errorText.textContent = 'Please enter a valid URL (e.g. https://docs.google.com/forms/...).';
    input.focus();
    return;
  }

  errorText.textContent = '';

  const fullUrl = url.startsWith('http') ? url : 'https://' + url;
  const code = encodeURL(fullUrl);
  lastGeneratedCode = code;

  const history = loadHistory();
  history.unshift({
    code,
    url: fullUrl,
    time: new Date().toLocaleString(),
  });
  if (history.length > 20) history.length = 20;
  saveHistory(history);

  document.getElementById('codeText').textContent = code;
  document.getElementById('resultLink').textContent = fullUrl;
  document.getElementById('resultLink').title = fullUrl;
  document.getElementById('resultTime').textContent = new Date().toLocaleString();

  document.getElementById('step1').classList.add('hidden');
  document.getElementById('step2').classList.remove('hidden');
  document.getElementById('cardTitle').textContent = 'Code Generated!';
  document.getElementById('cardSubtitle').textContent = 'Your test code is ready. Share it with your students.';

  renderHistory();
}

function copyCode() {
  const code = lastGeneratedCode;
  if (!code) return;

  navigator.clipboard.writeText(code).then(() => {
    showToast('Code copied to clipboard!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Code copied to clipboard!');
  });
}

function resetForm() {
  document.getElementById('linkInput').value = '';
  document.getElementById('errorText').textContent = '';
  document.getElementById('step1').classList.remove('hidden');
  document.getElementById('step2').classList.add('hidden');
  document.getElementById('cardTitle').textContent = 'Generate Test Code';
  document.getElementById('cardSubtitle').textContent =
    'Paste your Google Forms (or any test) link below to generate a unique code for your students.';
  document.getElementById('linkInput').focus();
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function renderHistory() {
  const container = document.getElementById('historyTable');
  const history = loadHistory();

  if (history.length === 0) {
    container.innerHTML = '<p class="empty-state">No codes generated yet.</p>';
    return;
  }

  let html = '<table><thead><tr><th>Code</th><th>Link</th><th>Created</th></tr></thead><tbody>';
  history.forEach((item) => {
    const shortCode = item.code.split('-')[0];
    html += `<tr>
      <td class="code-cell" title="${item.code}">${shortCode}…</td>
      <td class="link-cell" title="${item.url}">${item.url}</td>
      <td>${item.time}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  renderHistory();
  document.getElementById('linkInput').focus();
});

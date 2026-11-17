
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { apiRouter } from './api.js';
import { stremioRouter } from './stremio.js';

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

const supabase = supabaseUrl && supabaseSecretKey
  ? createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.supabase = supabase;
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'RedDemon',
    version: '0.1.0',
    databaseConfigured: Boolean(supabase)
  });
});

app.get('/test', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RedDemon</title>
<style>
body {
  background: #111;
  color: white;
  font-family: Arial, sans-serif;
  padding: 25px;
  max-width: 450px;
  margin: auto;
}
h1 { color: #e53935; }
input, button {
  box-sizing: border-box;
  width: 100%;
  padding: 14px;
  margin: 9px 0;
  border-radius: 7px;
  font-size: 16px;
}
input {
  background: #222;
  color: white;
  border: 1px solid #555;
}
button {
  background: #c62828;
  color: white;
  border: 0;
  font-weight: bold;
  cursor: pointer;
}
button:disabled { opacity: 0.5; }
#result, #addonResult {
  margin-top: 20px;
  padding: 14px;
  background: #222;
  border-radius: 7px;
  overflow-wrap: anywhere;
}
.section {
  margin-top: 25px;
  padding-top: 10px;
  border-top: 1px solid #444;
}
.keyItem {
  background: #222;
  border: 1px solid #444;
  border-radius: 7px;
  padding: 12px;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.keyItem p {
  margin: 7px 0;
  font-size: 14px;
}
.keyStatus { font-weight: bold; }
.revokeButton { background: #7f1d1d; }
.helpText {
  color: #bbb;
  font-size: 13px;
  line-height: 1.5;
}
</style>
</head>
<body>

<h1>RedDemon</h1>

<h2>Account Login</h2>
<p>Sign in using your RedDemon email and password.</p>

<form id="loginForm">
  <input id="email" type="email"
    placeholder="Email address" autocomplete="username" required>
  <input id="password" type="password"
    placeholder="Password" autocomplete="current-password" required>
  <button type="button" id="loginButton"
    onclick="window.loginRedDemon(); return false;">Sign In</button>
</form>

<div class="section">
  <h2>Connect Real-Debrid</h2>
  <p>Sign in first, then enter your existing Real-Debrid API token.</p>

  <input id="rdToken" type="password"
    placeholder="Real-Debrid API token"
    autocomplete="off" disabled>

  <button id="saveButton" type="button" disabled>
    Save &amp; Connect Real-Debrid
  </button>

  <button id="checkButton" type="button" disabled>
    Check Saved Real-Debrid Account
  </button>
</div>

<div class="section">
  <h2>RedDemon Cinema</h2>
  <p>Connect your PenguPlay manifest to use it as the RedDemon Cinema provider.</p>

  <input id="penguManifest" type="password"
    placeholder="Paste your current manifest URL"
    autocomplete="off" disabled>

  <button id="penguSaveButton" type="button" disabled>
    Save &amp; Connect RedDemon Cinema
  </button>

  <button id="penguCheckButton" type="button" disabled>
    Check RedDemon Cinema Connection
  </button>

  <button id="penguDisconnectButton" type="button" disabled>
    Disconnect RedDemon Cinema
  </button>

  <p class="helpText">
    Your manifest URL is sent securely to your RedDemon server and is not displayed after saving.
    Do not share your private manifest URL with anyone.
  </p>

  <div id="penguResult">
    Sign in to connect RedDemon Cinema.
  </div>
</div>

<div class="section">
  <h2>Test Direct HTTPS</h2>
  <p>Sign in first, then test RedDemon using a public sample MP4 link.</p>

  <button id="directTestButton" type="button" disabled>
    Test Direct HTTPS
  </button>
</div>

<div class="section">
  <h2>Addon Installation</h2>
  <p>Create a private installation link for your RedDemon addon. Keep this link private.</p>

  <button id="createAddonButton" type="button" disabled>
    Create RedDemon Addon Key
  </button>

  <div id="addonResult">
    Sign in to create your private addon installation link.
  </div>

  <button id="manageAddonButton" type="button" disabled>
    Manage Existing Addon Keys
  </button>

  <div id="addonKeys">
    Sign in and select Manage Existing Addon Keys to view your keys.
  </div>
</div>

<div id="result">Please sign in to RedDemon.</div>

<script>
let accessToken = '';

const result = document.getElementById('result');
const loginForm = document.getElementById('loginForm');
const loginButton = document.getElementById('loginButton');

const saveButton = document.getElementById('saveButton');
const checkButton = document.getElementById('checkButton');
const rdToken = document.getElementById('rdToken');

const directTestButton =
  document.getElementById('directTestButton');

const createAddonButton =
  document.getElementById('createAddonButton');

const manageAddonButton =
  document.getElementById('manageAddonButton');

const addonResult =
  document.getElementById('addonResult');

const addonKeys =
  document.getElementById('addonKeys');

const penguManifest =
  document.getElementById('penguManifest');

const penguSaveButton =
  document.getElementById('penguSaveButton');

const penguCheckButton =
  document.getElementById('penguCheckButton');

const penguDisconnectButton =
  document.getElementById('penguDisconnectButton');

const penguResult =
  document.getElementById('penguResult');

function showMessage(message) {
  result.textContent = message;
}

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message || data.error || 'Request failed.'
    );
  }

  return data;
}

function authHeaders() {
  return {
    Authorization: 'Bearer ' + accessToken
  };
}

// REAL-DEBRID

async function checkRealDebrid() {
  if (!accessToken) {
    showMessage('Please sign in to RedDemon first.');
    return;
  }

  checkButton.disabled = true;
  showMessage('Checking your saved Real-Debrid account...');

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/real_debrid/check',
      { headers: authHeaders() }
    );

    const data = await readResponse(response);

    showMessage(
      'SUCCESS! Real-Debrid is connected. Account details: ' +
      JSON.stringify(data.account || {})
    );
  } catch (error) {
    showMessage('Real-Debrid check: ' + error.message);
  } finally {
    checkButton.disabled = false;
  }
}

saveButton.addEventListener('click', async () => {
  const token = rdToken.value.trim();

  if (!accessToken) {
    showMessage('Please sign in to RedDemon first.');
    return;
  }

  if (!token) {
    showMessage('Please enter your Real-Debrid API token.');
    return;
  }

  saveButton.disabled = true;
  checkButton.disabled = true;
  showMessage('Securely saving your Real-Debrid account...');

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/real_debrid',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({
          accessToken: token
        })
      }
    );

    await readResponse(response);
    rdToken.value = '';

    showMessage(
      'Token saved securely. Now checking Real-Debrid...'
    );

    await checkRealDebrid();
  } catch (error) {
    showMessage(
      'Could not connect Real-Debrid: ' + error.message
    );
  } finally {
    saveButton.disabled = false;
    checkButton.disabled = false;
  }
});

checkButton.addEventListener('click', checkRealDebrid);

// REDDEMON CINEMA / PENGUPLAY

async function checkPenguPlay() {
  if (!accessToken) {
    penguResult.textContent =
      'Please sign in to RedDemon first.';
    return;
  }

  penguCheckButton.disabled = true;
  penguResult.textContent =
    'Checking RedDemon Cinema connection...';

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/penguplay/check',
      { headers: authHeaders() }
    );

    const data = await readResponse(response);

    penguResult.textContent =
      data.message ||
      data.status ||
      'RedDemon Cinema connection check completed.';

  } catch (error) {
    penguResult.textContent =
      'RedDemon Cinema check: ' + error.message;
  } finally {
    penguCheckButton.disabled = false;
  }
}

penguSaveButton.addEventListener('click', async () => {
  const manifestUrl = penguManifest.value.trim();

  if (!accessToken) {
    penguResult.textContent =
      'Please sign in to RedDemon first.';
    return;
  }

  if (!manifestUrl) {
    penguResult.textContent =
      'Please enter your current PenguPlay manifest URL.';
    return;
  }

  if (!/^https:\/\/.+/i.test(manifestUrl)) {
    penguResult.textContent =
      'The manifest URL must use HTTPS.';
    return;
  }

  penguSaveButton.disabled = true;
  penguCheckButton.disabled = true;

  penguResult.textContent =
    'Saving your RedDemon Cinema connection securely...';

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/penguplay',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders()
        },
        body: JSON.stringify({
          accessToken: manifestUrl
        })
      }
    );

    const data = await readResponse(response);

    penguManifest.value = '';

    penguResult.textContent =
      data.message ||
      'RedDemon Cinema manifest saved securely.';

    await checkPenguPlay();

  } catch (error) {
    penguResult.textContent =
      'Could not connect RedDemon Cinema: ' +
      error.message;
  } finally {
    penguSaveButton.disabled = false;
    penguCheckButton.disabled = false;
  }
});

penguCheckButton.addEventListener('click', checkPenguPlay);

penguDisconnectButton.addEventListener('click', async () => {
  if (!accessToken) {
    penguResult.textContent =
      'Please sign in to RedDemon first.';
    return;
  }

  const confirmed = window.confirm(
    'Disconnect RedDemon Cinema from your account?'
  );

  if (!confirmed) return;

  penguDisconnectButton.disabled = true;
  penguResult.textContent =
    'Disconnecting RedDemon Cinema...';

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/penguplay',
      {
        method: 'DELETE',
        headers: authHeaders()
      }
    );

    const data = await readResponse(response);

    penguResult.textContent =
      data.message ||
      'RedDemon Cinema has been disconnected.';

    penguManifest.value = '';

  } catch (error) {
    penguResult.textContent =
      'Could not disconnect RedDemon Cinema: ' +
      error.message;
  } finally {
    penguDisconnectButton.disabled = false;
  }
});

// DIRECT HTTPS TEST

directTestButton.addEventListener('click', async () => {
  if (!accessToken) {
    showMessage('Please sign in to RedDemon first.');
    return;
  }

  directTestButton.disabled = true;
  showMessage('Testing Direct HTTPS...');

  try {
    const sampleUrl =
      'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

    const requestUrl =
      '/api/v1/streams/movie/tt0133093?link=' +
      encodeURIComponent(sampleUrl);

    const response = await fetch(requestUrl, {
      headers: authHeaders()
    });

    const data = await readResponse(response);

    const directStreams = Array.isArray(data.streams)
      ? data.streams.filter(
          stream => stream.provider === 'direct_https'
        )
      : [];

    if (directStreams.length === 0) {
      showMessage(
        'The API responded, but no Direct HTTPS stream was returned: ' +
        JSON.stringify(data)
      );
      return;
    }

    showMessage(
      'SUCCESS! Direct HTTPS returned a stream: ' +
      JSON.stringify(directStreams)
    );

  } catch (error) {
    showMessage(
      'Direct HTTPS test failed: ' + error.message
    );
  } finally {
    directTestButton.disabled = false;
  }
});

// ADDON KEY MANAGEMENT

createAddonButton.addEventListener('click', async () => {
  if (!accessToken) {
    addonResult.textContent =
      'Please sign in to RedDemon first.';
    return;
  }

  createAddonButton.disabled = true;
  addonResult.textContent =
    'Creating your private addon key...';

  try {
    const response = await fetch('/api/v1/addon-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders()
      },
      body: JSON.stringify({
        label: 'RedDemon Addon'
      })
    });

    const data = await readResponse(response);
    const installUrl = data.installUrl || data.install_url;

    if (!installUrl) {
      throw new Error(
        'The server did not return an installation link.'
      );
    }

    addonResult.textContent =
      'Your private RedDemon installation link. Save it now; it may not be shown again: ' +
      installUrl;

    await loadAddonKeys();

  } catch (error) {
    addonResult.textContent =
      'Could not create addon key: ' + error.message;
  } finally {
    createAddonButton.disabled = false;
  }
});

async function loadAddonKeys() {
  if (!accessToken) {
    addonKeys.textContent = 'Please sign in first.';
    return;
  }

  addonKeys.textContent = 'Loading your addon keys...';
  manageAddonButton.disabled = true;

  try {
    const response = await fetch('/api/v1/addon-keys', {
      headers: authHeaders()
    });

    const data = await readResponse(response);
    const keys = Array.isArray(data.keys) ? data.keys : [];

    addonKeys.replaceChildren();

    if (keys.length === 0) {
      addonKeys.textContent =
        'You have no addon keys yet.';
      return;
    }

    keys.forEach((key) => {
      const item = document.createElement('div');
      item.className = 'keyItem';

      const label = document.createElement('p');
      label.textContent =
        'Name: ' + (key.label || 'RedDemon Addon');

      const created = document.createElement('p');
      created.textContent = 'Created: ' +
        (key.created_at
          ? new Date(key.created_at).toLocaleString()
          : 'Unknown');

      const used = document.createElement('p');
      used.textContent = 'Last used: ' +
        (key.last_used_at
          ? new Date(key.last_used_at).toLocaleString()
          : 'Not used yet');

      const status = document.createElement('p');
      status.className = 'keyStatus';

      const isRevoked = Boolean(key.revoked_at);
      status.textContent = isRevoked
        ? 'Status: Revoked'
        : 'Status: Active';

      item.append(label, created, used, status);

      if (!isRevoked) {
        const revokeButton =
          document.createElement('button');

        revokeButton.className = 'revokeButton';
        revokeButton.type = 'button';
        revokeButton.textContent = 'Revoke This Key';

        revokeButton.addEventListener('click', async () => {
          const confirmed = window.confirm(
            'Are you sure you want to revoke this addon key? Its installation link will stop working.'
          );

          if (!confirmed) return;

          revokeButton.disabled = true;
          revokeButton.textContent = 'Revoking...';

          try {
            const revokeResponse = await fetch(
              '/api/v1/addon-keys/' +
              encodeURIComponent(key.id),
              {
                method: 'DELETE',
                headers: authHeaders()
              }
            );

            await readResponse(revokeResponse);
            await loadAddonKeys();

            showMessage(
              'Addon key revoked successfully.'
            );

          } catch (error) {
            revokeButton.disabled = false;
            revokeButton.textContent = 'Revoke This Key';

            showMessage(
              'Could not revoke addon key: ' +
              error.message
            );
          }
        });

        item.appendChild(revokeButton);
      }

      addonKeys.appendChild(item);
    });

  } catch (error) {
    addonKeys.textContent =
      'Could not load addon keys: ' + error.message;
  } finally {
    manageAddonButton.disabled = false;
  }
}

manageAddonButton.addEventListener(
  'click',
  loadAddonKeys
);

// LOGIN

window.loginRedDemon = async function () {
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

  if (!emailInput || !passwordInput) {
    showMessage('Login form could not be found. Please refresh the page.');
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage('Please enter both your email address and password.');
    return;
  }

  loginButton.disabled = true;
  saveButton.disabled = true;
  checkButton.disabled = true;
  rdToken.disabled = true;
  directTestButton.disabled = true;
  createAddonButton.disabled = true;
  manageAddonButton.disabled = true;
  penguManifest.disabled = true;
  penguSaveButton.disabled = true;
  penguCheckButton.disabled = true;
  penguDisconnectButton.disabled = true;

  showMessage('Signing in to RedDemon...');

  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await readResponse(response);

    if (!data.session || !data.session.access_token) {
      throw new Error('Login did not return a session.');
    }

    accessToken = data.session.access_token;

    const check = await fetch('/api/v1/me', {
      headers: authHeaders()
    });

    const account = await readResponse(check);

    if (!account.authenticated) {
      throw new Error('RedDemon account verification failed.');
    }

    showMessage(
      'SUCCESS! RedDemon login is working. Signed in as: ' +
      (account.user && account.user.email ? account.user.email : email) +
      '. Your provider and addon controls are now enabled.'
    );

    rdToken.disabled = false;
    saveButton.disabled = false;
    checkButton.disabled = false;
    directTestButton.disabled = false;
    createAddonButton.disabled = false;
    manageAddonButton.disabled = false;
    penguManifest.disabled = false;
    penguSaveButton.disabled = false;
    penguCheckButton.disabled = false;
    penguDisconnectButton.disabled = false;

    penguResult.textContent =
      'You are signed in. Connect or check RedDemon Cinema above.';

  } catch (error) {
    accessToken = '';
    showMessage(
      'Login failed: ' +
      (error && error.message ? error.message : 'Unknown error.')
    );
  } finally {
    loginButton.disabled = false;
  }
};
</script>

</body>
</html>`);
});

app.use('/api/v1', apiRouter);
app.use('/stremio', stremioRouter);

app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    path: req.path
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log('RedDemon listening on port ' + port);
});

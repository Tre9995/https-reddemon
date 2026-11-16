
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

// RedDemon login and Real-Debrid test page
app.get('/test', (_req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RedDemon Test</title>
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
}
button:disabled {
  opacity: 0.5;
}
#result {
  margin-top: 20px;
  padding: 14px;
  background: #222;
  border-radius: 7px;
  overflow-wrap: anywhere;
}
</style>
</head>
<body>

<h1>RedDemon</h1>
<h2>Account Login Test</h2>
<p>Sign in using your RedDemon account.</p>

<form id="loginForm">
<input id="email" type="email"
placeholder="Email address" required>
<input id="password" type="password"
placeholder="Password" required>
<button type="submit" id="loginButton">Sign In</button>
</form>

<div id="result">Waiting for login...</div>

<button id="rdCheckButton" type="button" disabled>
Check Real-Debrid
</button>

<script>
let accessToken = '';

const form = document.getElementById('loginForm');
const result = document.getElementById('result');
const button = document.getElementById('loginButton');
const rdButton = document.getElementById('rdCheckButton');

rdButton.addEventListener('click', checkRealDebrid);

async function checkRealDebrid() {
  if (!accessToken) {
    result.textContent = 'Please sign in first.';
    return;
  }

  rdButton.disabled = true;
  result.textContent = 'Checking saved Real-Debrid account...';

  try {
    const response = await fetch(
      '/api/v1/provider-accounts/real_debrid/check',
      {
        headers: {
          'Authorization': 'Bearer ' + accessToken
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      result.textContent =
        'Real-Debrid check failed: ' +
        (data.message || data.error || 'Unknown error');
      return;
    }

    result.textContent =
      'SUCCESS! Real-Debrid account check completed: ' +
      JSON.stringify(data);

  } catch (error) {
    result.textContent =
      'Connection error while checking Real-Debrid.';
  } finally {
    rdButton.disabled = false;
  }
}

form.addEventListener('submit', async function(event) {
  event.preventDefault();
  button.disabled = true;
  rdButton.disabled = true;
  result.textContent = 'Signing in...';

  try {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });

    const data = await response.json();

    if (!response.ok || !data.session) {
      result.textContent =
        data.message || data.error || 'Login failed.';
      return;
    }

    accessToken = data.session.access_token;

    result.textContent = 'Checking RedDemon login...';

    const check = await fetch('/api/v1/me', {
      headers: {
        'Authorization': 'Bearer ' + accessToken
      }
    });

    const account = await check.json();

    if (check.ok && account.authenticated) {
      result.textContent =
        'SUCCESS! RedDemon login is working. Signed in as: ' +
        account.user.email;

      rdButton.disabled = false;
    } else {
      result.textContent =
        'Account verification failed: ' +
        (account.error || 'Unknown error');
    }

  } catch (error) {
    result.textContent =
      'Connection error. Please try again.';
  } finally {
    button.disabled = false;
  }
});
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
  console.log(`RedDemon listening on port ${port}`);
});
